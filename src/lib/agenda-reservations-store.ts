import { getSupabaseAdmin } from "./supabase-admin";
import { readDataFile } from "./storage-paths";

export type AgendaReservation = {
  id: string;
  sessionId: string;
  date: string;
  time: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_TABLE = "crm_storage";
const RESERVATIONS_KEY = "agenda-followup-reservations";

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 40;

function normalizeReservation(raw: Partial<AgendaReservation>): AgendaReservation {
  const now = new Date().toISOString();
  return {
    id: String(raw.id || `RSV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).trim(),
    sessionId: String(raw.sessionId || "").trim(),
    date: String(raw.date || "").trim(),
    time: String(raw.time || "").trim(),
    owner: String(raw.owner || "").trim(),
    createdAt: String(raw.createdAt || now).trim(),
    updatedAt: String(raw.updatedAt || now).trim(),
  };
}

function normalizeReservations(value: unknown): AgendaReservation[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeReservation(item as Partial<AgendaReservation>));
}

type StorageRow = { value: unknown; updated_at: string | null } | null;

async function readReservationsRow(): Promise<{ reservations: AgendaReservation[]; version: string | null }> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    // Fallback to readDataFile (non-Supabase environments)
    const raw = await readDataFile<Partial<AgendaReservation>[]>(RESERVATIONS_KEY + ".json", []);
    return { reservations: normalizeReservations(raw), version: null };
  }

  const { data, error } = await admin
    .from(STORAGE_TABLE)
    .select("value, updated_at")
    .eq("key", RESERVATIONS_KEY)
    .maybeSingle();

  if (error) {
    console.error("[RESERVATIONS] read error", error.message);
    return { reservations: [], version: null };
  }

  const row = data as StorageRow;
  if (!row) return { reservations: [], version: null };

  return {
    reservations: normalizeReservations(row.value),
    version: row.updated_at ?? null,
  };
}

async function writeReservationsIfVersion(
  reservations: AgendaReservation[],
  expectedVersion: string | null,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;

  const nowIso = new Date().toISOString();

  if (expectedVersion === null) {
    // No row exists yet: INSERT, fail if another instance raced us
    const { error } = await admin
      .from(STORAGE_TABLE)
      .insert({ key: RESERVATIONS_KEY, value: reservations, updated_at: nowIso });

    if (error) {
      // Unique constraint violation (23505) = another instance inserted first → retry
      return false;
    }
    return true;
  }

  // Row exists: conditional update — only applies if updated_at still matches
  const { data, error } = await admin
    .from(STORAGE_TABLE)
    .update({ value: reservations, updated_at: nowIso })
    .eq("key", RESERVATIONS_KEY)
    .eq("updated_at", expectedVersion)
    .select("key");

  if (error) {
    console.error("[RESERVATIONS] conditional update error", error.message);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

/**
 * Reads the current reservations list (best-effort, no lock).
 * Safe for validation / availability checks — eventual consistency is acceptable here.
 */
export async function getAgendaReservations(): Promise<AgendaReservation[]> {
  const { reservations } = await readReservationsRow();
  return reservations;
}

/**
 * Distributed optimistic-concurrency lock for reservation writes.
 *
 * The handler receives the current reservations and must return either:
 *   { ok: false; result: T }          — no write needed (e.g. conflict detected)
 *   { ok: true; reservations: ...; result: T } — write the new reservations array
 *
 * The wrapper reads the row version, runs the handler, and writes back only if
 * the version in Supabase is still the same. On a CAS conflict it retries up to
 * MAX_RETRIES times with exponential back-off.
 *
 * This replaces the previous in-memory queue which was useless across serverless
 * instances.
 */
export async function withAgendaReservationsLock<T>(
  handler: (
    reservations: AgendaReservation[],
  ) => Promise<{ ok: false; result: T } | { ok: true; reservations: AgendaReservation[]; result: T }>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { reservations, version } = await readReservationsRow();
    const outcome = await handler(reservations);

    if (!outcome.ok) return outcome.result;

    const saved = await writeReservationsIfVersion(outcome.reservations, version);
    if (saved) return outcome.result;

    // CAS conflict: another instance wrote in between — wait and retry
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_BASE_MS * (attempt + 1)));
  }

  throw new Error("AGENDA_RESERVATIONS_LOCK_EXHAUSTED");
}

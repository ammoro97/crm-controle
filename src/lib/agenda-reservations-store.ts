import { readDataFile, writeDataFile } from "@/lib/storage-paths";

export type AgendaReservation = {
  id: string;
  sessionId: string;
  date: string;
  time: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
};

const AGENDA_RESERVATIONS_FILE = "agenda-followup-reservations.json";

let queue: Promise<void> = Promise.resolve();

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

export async function getAgendaReservations(): Promise<AgendaReservation[]> {
  const raw = await readDataFile<Partial<AgendaReservation>[]>(AGENDA_RESERVATIONS_FILE, []);
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeReservation(item));
}

export async function saveAgendaReservations(next: AgendaReservation[]) {
  await writeDataFile(AGENDA_RESERVATIONS_FILE, next);
}

export async function withAgendaReservationsLock<T>(handler: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await handler();
  } finally {
    release();
  }
}

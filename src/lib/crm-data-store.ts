"use client";

import { normalizeMeetingsSnapshot } from "@/lib/agenda-events";
import { Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";
import { applyServerWrapupsSnapshot, type PostCallWrapup } from "@/lib/post-call-flow";

type LeadArchiveEntry = { lead: Lead; meetings?: Meeting[]; finalizadoEm: string; motivo: string };

export const LEADS_STORAGE_KEY = "crm.leads.v1";
export const MEETINGS_STORAGE_KEY = "crm.agenda.meetings.v1";
export const CUSTOMERS_STORAGE_KEY = "crm.customers.v1";
export const LEAD_FINALIZATIONS_STORAGE_KEY = "crm.leads.finalizations.v1";

const LEADS_EVENT = "crm:leads:changed";
const MEETINGS_EVENT = "crm:meetings:changed";
const CUSTOMERS_EVENT = "crm:customers:changed";
const LEAD_FINALIZATIONS_EVENT = "crm:lead-finalizations:changed";
const SNAPSHOTS_ENDPOINT = "/api/crm/snapshots";

type SnapshotPayloadField = "leads" | "meetings" | "customers" | "leadFinalizations";

type SnapshotPayload = {
  leads?: Lead[];
  meetings?: Meeting[];
  customers?: Lead[];
  leadFinalizations?: LeadFinalizationRecord[];
  deletedLeadIds?: string[];
  deletedCustomerIds?: string[];
  archivedLeads?: LeadArchiveEntry[];
};

type SnapshotResponse = {
  success?: boolean;
  snapshots?: SnapshotPayload & { wrapups?: unknown[] };
  pagination?: { page: number; pageSize: number; hasMore: boolean };
};

const syncQueue = new Map<SnapshotPayloadField, unknown>();
const pendingDeleteIds = {
  leads: new Set<string>(),
  customers: new Set<string>(),
};
const pendingArchiveLeads = new Map<string, LeadArchiveEntry>(); // keyed by lead.id
let syncInFlight = false;
let hydrationStarted = false;
// Lock para evitar hidratações concorrentes (ex: background sync disparando enquanto
// a hidratação inicial ainda está carregando páginas).
let hydrationInFlight = false;
const MAX_INITIAL_HYDRATION_PAGES = 200;
const MAX_BACKGROUND_HYDRATION_PAGES = 1;

type HydrationMode = "initial" | "background";

function cloneLeads(leads: Lead[]): Lead[] {
  return leads.map((lead) => ({ ...lead }));
}

function cloneMeetings(meetings: Meeting[]): Meeting[] {
  return normalizeMeetingsSnapshot(meetings).map((meeting) => ({ ...meeting }));
}

function cloneLeadFinalizations(records: LeadFinalizationRecord[]): LeadFinalizationRecord[] {
  return records.map((record) => ({ ...record }));
}

function isBrowser() {
  return typeof window !== "undefined";
}

function reportStoreClientError(context: string, error: unknown) {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(`[CRM_DATA_STORE] ${context}`, error);
  }
}

function parseStorageArray<T>(storageKey: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    reportStoreClientError(`parseStorageArray:${storageKey}`, error);
    return [];
  }
}

function mapStorageKeyToPayloadField(storageKey: string): SnapshotPayloadField | null {
  if (storageKey === LEADS_STORAGE_KEY) return "leads";
  if (storageKey === MEETINGS_STORAGE_KEY) return "meetings";
  if (storageKey === CUSTOMERS_STORAGE_KEY) return "customers";
  if (storageKey === LEAD_FINALIZATIONS_STORAGE_KEY) return "leadFinalizations";
  return null;
}

function hasPendingSyncQueue() {
  return syncQueue.size > 0;
}

function hasPendingDeletes() {
  return pendingDeleteIds.leads.size > 0 || pendingDeleteIds.customers.size > 0 || pendingArchiveLeads.size > 0;
}

function canBackgroundRehydrate() {
  return !hasPendingSyncQueue() && !syncInFlight && !hasPendingDeletes() && !hydrationInFlight;
}

function scheduleSyncFlush() {
  if (!isBrowser()) return;
  void flushSyncQueue();
}

function applyFieldSnapshot(field: SnapshotPayloadField, value: unknown) {
  if (field === "leads") {
    applyHydratedSnapshot(LEADS_STORAGE_KEY, LEADS_EVENT, cloneLeads(value as Lead[]));
    return;
  }
  if (field === "meetings") {
    applyHydratedSnapshot(MEETINGS_STORAGE_KEY, MEETINGS_EVENT, cloneMeetings(value as Meeting[]));
    return;
  }
  if (field === "customers") {
    applyHydratedSnapshot(CUSTOMERS_STORAGE_KEY, CUSTOMERS_EVENT, cloneLeads(value as Lead[]));
    return;
  }
  if (field === "leadFinalizations") {
    applyHydratedSnapshot(
      LEAD_FINALIZATIONS_STORAGE_KEY,
      LEAD_FINALIZATIONS_EVENT,
      cloneLeadFinalizations(value as LeadFinalizationRecord[]),
    );
  }
}

async function flushSyncQueue() {
  if (!isBrowser()) return;
  if (syncInFlight || !hasPendingSyncQueue()) return;

  syncInFlight = true;
  const pendingEntries = Array.from(syncQueue.entries());
  const snapshotDeletedLeadIds = [...pendingDeleteIds.leads];
  const snapshotDeletedCustomerIds = [...pendingDeleteIds.customers];
  const snapshotArchivedLeads = [...pendingArchiveLeads.values()];
  syncQueue.clear();
  pendingDeleteIds.leads.clear();
  pendingDeleteIds.customers.clear();
  pendingArchiveLeads.clear();

  const payload: Partial<SnapshotPayload> = {};
  for (const [field, value] of pendingEntries) {
    if (field === "leads") payload.leads = value as Lead[];
    if (field === "meetings") payload.meetings = value as Meeting[];
    if (field === "customers") payload.customers = value as Lead[];
    if (field === "leadFinalizations") payload.leadFinalizations = value as LeadFinalizationRecord[];
  }
  if (snapshotDeletedLeadIds.length > 0) payload.deletedLeadIds = snapshotDeletedLeadIds;
  if (snapshotDeletedCustomerIds.length > 0) payload.deletedCustomerIds = snapshotDeletedCustomerIds;
  if (snapshotArchivedLeads.length > 0) payload.archivedLeads = snapshotArchivedLeads;

  try {
    const response = await fetch(SNAPSHOTS_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error("SNAPSHOT_SYNC_FAILED");
    }

    for (const [field, value] of pendingEntries) {
      applyFieldSnapshot(field, value);
    }
  } catch (error) {
    reportStoreClientError("flushSyncQueue", error);
    for (const [field, value] of pendingEntries) {
      if (!syncQueue.has(field)) {
        syncQueue.set(field, value);
      }
    }
    // Re-queue pending deletes/archives that failed to sync
    snapshotDeletedLeadIds.forEach((id) => pendingDeleteIds.leads.add(id));
    snapshotDeletedCustomerIds.forEach((id) => pendingDeleteIds.customers.add(id));
    snapshotArchivedLeads.forEach((entry) => pendingArchiveLeads.set(entry.lead.id, entry));
  } finally {
    syncInFlight = false;
    if (hasPendingSyncQueue()) {
      scheduleSyncFlush();
    }
  }
}

function enqueueSnapshotSync(storageKey: string, payloadValue: unknown) {
  if (!isBrowser()) return;
  const payloadField = mapStorageKeyToPayloadField(storageKey);
  if (!payloadField) return;
  syncQueue.set(payloadField, payloadValue);
  scheduleSyncFlush();
}

function applyHydratedSnapshot(storageKey: string, eventName: string, value: unknown[]): boolean {
  if (!isBrowser()) return false;
  const serialized = JSON.stringify(value);
  const previous = window.localStorage.getItem(storageKey);
  if (previous === serialized) return false;
  window.localStorage.setItem(storageKey, serialized);
  window.dispatchEvent(new CustomEvent(eventName, { detail: value }));
  return true;
}

async function hydrateSnapshotsFromServer(mode: HydrationMode = "initial") {
  if (!isBrowser()) return false;
  // Evita hidratações concorrentes: se o background sync disparar enquanto a
  // hidratação inicial ainda está buscando páginas, ignora a segunda chamada.
  if (hydrationInFlight) return false;
  hydrationInFlight = true;

  try {
    let page = 0;
    const accumulatedLeads: Lead[] = [];
    let hasLoadedLeadPage = false;
    let hasSuccessfulPage = false;
    // Limite de segurança: evita loop infinito em caso de bug no servidor.
    const maxPages = mode === "initial" ? MAX_INITIAL_HYDRATION_PAGES : MAX_BACKGROUND_HYDRATION_PAGES;

    while (page < maxPages) {
      const response = await fetch(`${SNAPSHOTS_ENDPOINT}?page=${page}`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) break;

      const data = (await response.json()) as SnapshotResponse;
      if (!data.success || !data.snapshots) break;
      hasSuccessfulPage = true;

      // Dados não-leads (meetings, customers etc.) chegam somente na página 0.
      if (page === 0) {
        if (Array.isArray(data.snapshots.meetings)) {
          applyHydratedSnapshot(MEETINGS_STORAGE_KEY, MEETINGS_EVENT, cloneMeetings(data.snapshots.meetings));
        }
        if (Array.isArray(data.snapshots.customers)) {
          applyHydratedSnapshot(CUSTOMERS_STORAGE_KEY, CUSTOMERS_EVENT, cloneLeads(data.snapshots.customers));
        }
        if (Array.isArray(data.snapshots.leadFinalizations)) {
          applyHydratedSnapshot(
            LEAD_FINALIZATIONS_STORAGE_KEY,
            LEAD_FINALIZATIONS_EVENT,
            cloneLeadFinalizations(data.snapshots.leadFinalizations),
          );
        }
        // Mescla wrapups de todos os vendedores para exibicao global de finalizacoes.
        if (Array.isArray(data.snapshots.wrapups)) {
          applyServerWrapupsSnapshot(data.snapshots.wrapups as PostCallWrapup[]);
        }
      }

      if (Array.isArray(data.snapshots.leads)) {
        hasLoadedLeadPage = true;
        accumulatedLeads.push(...data.snapshots.leads);
        // Emite após cada página para a UI começar a renderizar progressivamente
        // sem esperar o carregamento completo de todos os leads.
      }

      // Se não há mais páginas, encerra o loop.
      if (!data.pagination?.hasMore) break;
      page++;
    }
    if (hasLoadedLeadPage) {
      if (mode === "background") {
        const existingLeads = parseStorageArray<Lead>(LEADS_STORAGE_KEY);
        const incomingById = new Map<string, Lead>();
        for (const lead of accumulatedLeads) {
          incomingById.set(lead.id, lead);
        }
        const mergedLeads: Lead[] = [
          ...accumulatedLeads,
          ...existingLeads.filter((lead) => !incomingById.has(lead.id)),
        ];
        applyHydratedSnapshot(LEADS_STORAGE_KEY, LEADS_EVENT, cloneLeads(mergedLeads));
      } else {
        applyHydratedSnapshot(LEADS_STORAGE_KEY, LEADS_EVENT, cloneLeads(accumulatedLeads));
      }
    }
    return hasSuccessfulPage;
  } catch (error) {
    reportStoreClientError(`hydrateSnapshotsFromServer:${mode}`, error);
    return false;
  } finally {
    hydrationInFlight = false;
  }
}

function ensureSnapshotsHydrated() {
  if (!isBrowser()) return;
  if (hydrationStarted) return;
  hydrationStarted = true;
  void hydrateSnapshotsFromServer("initial");
}

export function getLeadsSnapshot(): Lead[] {
  ensureSnapshotsHydrated();
  return cloneLeads(parseStorageArray<Lead>(LEADS_STORAGE_KEY));
}

export function setLeadsSnapshot(next: Lead[], deletedIds?: string[], archiveEntries?: LeadArchiveEntry[]) {
  if (typeof window === "undefined") return;
  const safeNext = cloneLeads(next);
  if (deletedIds?.length) {
    deletedIds.forEach((id) => pendingDeleteIds.leads.add(id));
  }
  if (archiveEntries?.length) {
    archiveEntries.forEach((entry) => pendingArchiveLeads.set(entry.lead.id, entry));
  }
  enqueueSnapshotSync(LEADS_STORAGE_KEY, safeNext);
}

export function getMeetingsSnapshot(): Meeting[] {
  ensureSnapshotsHydrated();
  return cloneMeetings(parseStorageArray<Meeting>(MEETINGS_STORAGE_KEY));
}

export function setMeetingsSnapshot(next: Meeting[]) {
  if (typeof window === "undefined") return;
  const safeNext = cloneMeetings(next);
  enqueueSnapshotSync(MEETINGS_STORAGE_KEY, safeNext);
}

export function getCustomersSnapshot(): Lead[] {
  ensureSnapshotsHydrated();
  return cloneLeads(parseStorageArray<Lead>(CUSTOMERS_STORAGE_KEY));
}

export function setCustomersSnapshot(next: Lead[], deletedIds?: string[]) {
  if (typeof window === "undefined") return;
  const safeNext = cloneLeads(next);
  if (deletedIds?.length) {
    deletedIds.forEach((id) => pendingDeleteIds.customers.add(id));
  }
  enqueueSnapshotSync(CUSTOMERS_STORAGE_KEY, safeNext);
}

export function getLeadFinalizationsSnapshot(): LeadFinalizationRecord[] {
  ensureSnapshotsHydrated();
  return cloneLeadFinalizations(parseStorageArray<LeadFinalizationRecord>(LEAD_FINALIZATIONS_STORAGE_KEY));
}

export function setLeadFinalizationsSnapshot(next: LeadFinalizationRecord[]) {
  if (typeof window === "undefined") return;
  const safeNext = cloneLeadFinalizations(next);
  enqueueSnapshotSync(LEAD_FINALIZATIONS_STORAGE_KEY, safeNext);
}

export function subscribeLeadsSnapshot(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === LEADS_STORAGE_KEY) listener();
  };
  window.addEventListener(LEADS_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LEADS_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function subscribeMeetingsSnapshot(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === MEETINGS_STORAGE_KEY) listener();
  };
  window.addEventListener(MEETINGS_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MEETINGS_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function subscribeCustomersSnapshot(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === CUSTOMERS_STORAGE_KEY) listener();
  };
  window.addEventListener(CUSTOMERS_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CUSTOMERS_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function subscribeLeadFinalizationsSnapshot(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === LEAD_FINALIZATIONS_STORAGE_KEY) listener();
  };
  window.addEventListener(LEAD_FINALIZATIONS_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LEAD_FINALIZATIONS_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

// ---------------------------------------------------------------------------
// Background sync — cross-user realtime via polling + visibilitychange
// ---------------------------------------------------------------------------

const BACKGROUND_SYNC_INTERVAL_MS = 60_000;
const BACKGROUND_SYNC_MAX_BACKOFF_MS = 15 * 60_000;
let backgroundSyncTimer: ReturnType<typeof setInterval> | null = null;
let backgroundSyncFailureCount = 0;
let backgroundSyncBlockedUntil = 0;

async function runBackgroundRehydrate() {
  if (!isBrowser()) return;
  if (document.visibilityState !== "visible") return;
  if (!canBackgroundRehydrate()) return;
  if (Date.now() < backgroundSyncBlockedUntil) return;

  try {
    const success = await hydrateSnapshotsFromServer("background");
    if (success) {
      backgroundSyncFailureCount = 0;
      backgroundSyncBlockedUntil = 0;
      return;
    }

    backgroundSyncFailureCount = Math.min(backgroundSyncFailureCount + 1, 8);
    const backoffMs = Math.min(
      BACKGROUND_SYNC_INTERVAL_MS * 2 ** (backgroundSyncFailureCount - 1),
      BACKGROUND_SYNC_MAX_BACKOFF_MS,
    );
    backgroundSyncBlockedUntil = Date.now() + backoffMs;
  } catch (error) {
    reportStoreClientError("runBackgroundRehydrate", error);
    backgroundSyncFailureCount = Math.min(backgroundSyncFailureCount + 1, 8);
    const backoffMs = Math.min(
      BACKGROUND_SYNC_INTERVAL_MS * 2 ** (backgroundSyncFailureCount - 1),
      BACKGROUND_SYNC_MAX_BACKOFF_MS,
    );
    backgroundSyncBlockedUntil = Date.now() + backoffMs;
  }
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    void runBackgroundRehydrate();
  }
}

/**
 * Starts periodic background sync (60s interval + tab visibility).
 * Only re-hydrates when there are no pending local writes to avoid
 * overwriting in-flight changes.
 * Call once after the user is authenticated (e.g. in AppShell).
 */
export function startBackgroundSync() {
  if (!isBrowser()) return;
  if (backgroundSyncTimer !== null) return;
  backgroundSyncFailureCount = 0;
  backgroundSyncBlockedUntil = 0;

  backgroundSyncTimer = setInterval(() => {
    void runBackgroundRehydrate();
  }, BACKGROUND_SYNC_INTERVAL_MS);

  document.addEventListener("visibilitychange", onVisibilityChange);
  void runBackgroundRehydrate();
}

/**
 * Stops background sync. Call on logout or AppShell unmount.
 */
export function stopBackgroundSync() {
  if (!isBrowser()) return;
  if (backgroundSyncTimer !== null) {
    clearInterval(backgroundSyncTimer);
    backgroundSyncTimer = null;
  }
  backgroundSyncFailureCount = 0;
  backgroundSyncBlockedUntil = 0;
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

"use client";

import { normalizeMeetingsSnapshot } from "@/lib/agenda-events";
import { Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";

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
};

type SnapshotResponse = {
  success?: boolean;
  snapshots?: SnapshotPayload;
};

const syncQueue = new Map<SnapshotPayloadField, unknown>();
const pendingDeleteIds = {
  leads: new Set<string>(),
  customers: new Set<string>(),
};
let syncInFlight = false;
let hydrationStarted = false;

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
  return pendingDeleteIds.leads.size > 0 || pendingDeleteIds.customers.size > 0;
}

function canBackgroundRehydrate() {
  return !hasPendingSyncQueue() && !syncInFlight && !hasPendingDeletes();
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
  syncQueue.clear();
  pendingDeleteIds.leads.clear();
  pendingDeleteIds.customers.clear();

  const payload: Partial<SnapshotPayload> = {};
  for (const [field, value] of pendingEntries) {
    if (field === "leads") payload.leads = value as Lead[];
    if (field === "meetings") payload.meetings = value as Meeting[];
    if (field === "customers") payload.customers = value as Lead[];
    if (field === "leadFinalizations") payload.leadFinalizations = value as LeadFinalizationRecord[];
  }
  if (snapshotDeletedLeadIds.length > 0) payload.deletedLeadIds = snapshotDeletedLeadIds;
  if (snapshotDeletedCustomerIds.length > 0) payload.deletedCustomerIds = snapshotDeletedCustomerIds;

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
  } catch {
    for (const [field, value] of pendingEntries) {
      if (!syncQueue.has(field)) {
        syncQueue.set(field, value);
      }
    }
    // Re-queue pending deletes that failed to sync
    snapshotDeletedLeadIds.forEach((id) => pendingDeleteIds.leads.add(id));
    snapshotDeletedCustomerIds.forEach((id) => pendingDeleteIds.customers.add(id));
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

function applyHydratedSnapshot(storageKey: string, eventName: string, value: unknown[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(storageKey, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(eventName, { detail: value }));
}

async function hydrateSnapshotsFromServer() {
  if (!isBrowser()) return;
  try {
    const response = await fetch(SNAPSHOTS_ENDPOINT, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) return;

    const data = (await response.json()) as SnapshotResponse;
    if (!data.success || !data.snapshots) return;

    if (Array.isArray(data.snapshots.leads)) {
      applyHydratedSnapshot(LEADS_STORAGE_KEY, LEADS_EVENT, cloneLeads(data.snapshots.leads));
    }
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
  } catch {
    // Falha de rede/autorizacao nao deve quebrar o fluxo local.
  }
}

function ensureSnapshotsHydrated() {
  if (!isBrowser()) return;
  if (hydrationStarted) return;
  hydrationStarted = true;
  window.localStorage.removeItem(LEADS_STORAGE_KEY);
  window.localStorage.removeItem(MEETINGS_STORAGE_KEY);
  window.localStorage.removeItem(CUSTOMERS_STORAGE_KEY);
  window.localStorage.removeItem(LEAD_FINALIZATIONS_STORAGE_KEY);
  void hydrateSnapshotsFromServer();
}

export function getLeadsSnapshot(): Lead[] {
  ensureSnapshotsHydrated();
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEADS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return cloneLeads(parsed as Lead[]);
  } catch {
    return [];
  }
}

export function setLeadsSnapshot(next: Lead[], deletedIds?: string[]) {
  if (typeof window === "undefined") return;
  const safeNext = cloneLeads(next);
  if (deletedIds?.length) {
    deletedIds.forEach((id) => pendingDeleteIds.leads.add(id));
  }
  enqueueSnapshotSync(LEADS_STORAGE_KEY, safeNext);
}

export function getMeetingsSnapshot(): Meeting[] {
  ensureSnapshotsHydrated();
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MEETINGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return cloneMeetings(parsed as Meeting[]);
  } catch {
    return [];
  }
}

export function setMeetingsSnapshot(next: Meeting[]) {
  if (typeof window === "undefined") return;
  const safeNext = cloneMeetings(next);
  enqueueSnapshotSync(MEETINGS_STORAGE_KEY, safeNext);
}

export function getCustomersSnapshot(): Lead[] {
  ensureSnapshotsHydrated();
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOMERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return cloneLeads(parsed as Lead[]);
  } catch {
    return [];
  }
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
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEAD_FINALIZATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return cloneLeadFinalizations(parsed as LeadFinalizationRecord[]);
  } catch {
    return [];
  }
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
let backgroundSyncTimer: ReturnType<typeof setInterval> | null = null;

async function runBackgroundRehydrate() {
  if (!isBrowser()) return;
  if (!canBackgroundRehydrate()) return;
  try {
    await hydrateSnapshotsFromServer();
  } catch {
    // Background failures are silent — UI must not break
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

  backgroundSyncTimer = setInterval(() => {
    void runBackgroundRehydrate();
  }, BACKGROUND_SYNC_INTERVAL_MS);

  document.addEventListener("visibilitychange", onVisibilityChange);
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
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

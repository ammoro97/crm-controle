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
};

type SnapshotResponse = {
  success?: boolean;
  snapshots?: SnapshotPayload;
};

const syncQueue = new Map<SnapshotPayloadField, unknown>();
let syncTimer: number | null = null;
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

function scheduleSyncFlush() {
  if (!isBrowser()) return;
  if (syncTimer !== null) {
    window.clearTimeout(syncTimer);
  }
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    void flushSyncQueue();
  }, 420);
}

async function flushSyncQueue() {
  if (!isBrowser()) return;
  if (syncInFlight || !hasPendingSyncQueue()) return;

  syncInFlight = true;
  const pendingEntries = Array.from(syncQueue.entries());
  syncQueue.clear();

  const payload: Partial<SnapshotPayload> = {};
  for (const [field, value] of pendingEntries) {
    if (field === "leads") payload.leads = value as Lead[];
    if (field === "meetings") payload.meetings = value as Meeting[];
    if (field === "customers") payload.customers = value as Lead[];
    if (field === "leadFinalizations") payload.leadFinalizations = value as LeadFinalizationRecord[];
  }

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
  } catch {
    for (const [field, value] of pendingEntries) {
      if (!syncQueue.has(field)) {
        syncQueue.set(field, value);
      }
    }
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
  void hydrateSnapshotsFromServer();
}

export function getLeadsSnapshot(): Lead[] {
  ensureSnapshotsHydrated();
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEADS_STORAGE_KEY);
    if (!raw) {
      const empty: Lead[] = [];
      window.localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(empty));
      window.dispatchEvent(new CustomEvent(LEADS_EVENT, { detail: empty }));
      enqueueSnapshotSync(LEADS_STORAGE_KEY, empty);
      return empty;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      const empty: Lead[] = [];
      window.localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(empty));
      window.dispatchEvent(new CustomEvent(LEADS_EVENT, { detail: empty }));
      enqueueSnapshotSync(LEADS_STORAGE_KEY, empty);
      return empty;
    }
    return cloneLeads(parsed as Lead[]);
  } catch {
    const empty: Lead[] = [];
    window.localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(empty));
    window.dispatchEvent(new CustomEvent(LEADS_EVENT, { detail: empty }));
    enqueueSnapshotSync(LEADS_STORAGE_KEY, empty);
    return empty;
  }
}

export function setLeadsSnapshot(next: Lead[]) {
  if (typeof window === "undefined") return;
  const safeNext = cloneLeads(next);
  window.localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(safeNext));
  window.dispatchEvent(new CustomEvent(LEADS_EVENT, { detail: safeNext }));
  enqueueSnapshotSync(LEADS_STORAGE_KEY, safeNext);
}

export function getMeetingsSnapshot(): Meeting[] {
  ensureSnapshotsHydrated();
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MEETINGS_STORAGE_KEY);
    if (!raw) {
      const empty: Meeting[] = [];
      window.localStorage.setItem(MEETINGS_STORAGE_KEY, JSON.stringify(empty));
      window.dispatchEvent(new CustomEvent(MEETINGS_EVENT, { detail: empty }));
      enqueueSnapshotSync(MEETINGS_STORAGE_KEY, empty);
      return empty;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      const empty: Meeting[] = [];
      window.localStorage.setItem(MEETINGS_STORAGE_KEY, JSON.stringify(empty));
      window.dispatchEvent(new CustomEvent(MEETINGS_EVENT, { detail: empty }));
      enqueueSnapshotSync(MEETINGS_STORAGE_KEY, empty);
      return empty;
    }
    return cloneMeetings(parsed as Meeting[]);
  } catch {
    const empty: Meeting[] = [];
    window.localStorage.setItem(MEETINGS_STORAGE_KEY, JSON.stringify(empty));
    window.dispatchEvent(new CustomEvent(MEETINGS_EVENT, { detail: empty }));
    enqueueSnapshotSync(MEETINGS_STORAGE_KEY, empty);
    return empty;
  }
}

export function setMeetingsSnapshot(next: Meeting[]) {
  if (typeof window === "undefined") return;
  const safeNext = cloneMeetings(next);
  window.localStorage.setItem(MEETINGS_STORAGE_KEY, JSON.stringify(safeNext));
  window.dispatchEvent(new CustomEvent(MEETINGS_EVENT, { detail: safeNext }));
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

export function setCustomersSnapshot(next: Lead[]) {
  if (typeof window === "undefined") return;
  const safeNext = cloneLeads(next);
  window.localStorage.setItem(CUSTOMERS_STORAGE_KEY, JSON.stringify(safeNext));
  window.dispatchEvent(new CustomEvent(CUSTOMERS_EVENT, { detail: safeNext }));
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
  window.localStorage.setItem(LEAD_FINALIZATIONS_STORAGE_KEY, JSON.stringify(safeNext));
  window.dispatchEvent(new CustomEvent(LEAD_FINALIZATIONS_EVENT, { detail: safeNext }));
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

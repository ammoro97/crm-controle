"use client";

import { initialLeads, initialMeetings } from "@/lib/mock-data";
import { normalizeMeetingsSnapshot } from "@/lib/agenda-events";
import { Lead, Meeting } from "@/types/crm";

export const LEADS_STORAGE_KEY = "crm.leads.v1";
export const MEETINGS_STORAGE_KEY = "crm.agenda.meetings.v1";

const LEADS_EVENT = "crm:leads:changed";
const MEETINGS_EVENT = "crm:meetings:changed";

function cloneLeads(leads: Lead[]): Lead[] {
  return leads.map((lead) => ({ ...lead }));
}

function cloneMeetings(meetings: Meeting[]): Meeting[] {
  return normalizeMeetingsSnapshot(meetings).map((meeting) => ({ ...meeting }));
}

export function getLeadsSnapshot(): Lead[] {
  if (typeof window === "undefined") return cloneLeads(initialLeads);
  try {
    const raw = window.localStorage.getItem(LEADS_STORAGE_KEY);
    if (!raw) return cloneLeads(initialLeads);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return cloneLeads(initialLeads);
    return cloneLeads(parsed as Lead[]);
  } catch {
    return cloneLeads(initialLeads);
  }
}

export function setLeadsSnapshot(next: Lead[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(LEADS_EVENT, { detail: next }));
}

export function getMeetingsSnapshot(): Meeting[] {
  if (typeof window === "undefined") return cloneMeetings(initialMeetings);
  try {
    const raw = window.localStorage.getItem(MEETINGS_STORAGE_KEY);
    if (!raw) return cloneMeetings(initialMeetings);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return cloneMeetings(initialMeetings);
    return cloneMeetings(parsed as Meeting[]);
  } catch {
    return cloneMeetings(initialMeetings);
  }
}

export function setMeetingsSnapshot(next: Meeting[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MEETINGS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(MEETINGS_EVENT, { detail: next }));
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

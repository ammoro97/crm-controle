"use client";

/**
 * Filtros persistidos por usuário no localStorage.
 * Cada usuário tem seu namespace isolado (keyed by userId).
 * Usado em Leads, Outbound e Dashboard.
 */

const FILTERS_STORAGE_KEY = "crm.ui.filters.v1";

export type LeadsFiltersState = {
  ownerFilter: string;
  searchTerm: string;
};

export type DashboardFiltersState = {
  periodo: string;
  vendedorId?: string;
  from?: string;
  to?: string;
};

type AllFilters = {
  leads?: LeadsFiltersState;
  outbound?: LeadsFiltersState;
  dashboard?: DashboardFiltersState;
};

type PerUserFilters = Record<string, AllFilters>;

function readPerUser(): PerUserFilters {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as PerUserFilters;
  } catch {
    return {};
  }
}

function writePerUser(data: PerUserFilters) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

export function getLeadsFilters(userId: string, scope: "leads" | "outbound"): LeadsFiltersState {
  const all = readPerUser();
  return (
    all[userId]?.[scope] ?? {
      ownerFilter: "Todos",
      searchTerm: "",
    }
  );
}

export function setLeadsFilters(userId: string, scope: "leads" | "outbound", filters: LeadsFiltersState) {
  const all = readPerUser();
  if (!all[userId]) all[userId] = {};
  all[userId][scope] = filters;
  writePerUser(all);
}

export function getDashboardFilters(userId: string): DashboardFiltersState | null {
  const all = readPerUser();
  return all[userId]?.dashboard ?? null;
}

export function setDashboardFilters(userId: string, filters: DashboardFiltersState) {
  const all = readPerUser();
  if (!all[userId]) all[userId] = {};
  all[userId].dashboard = filters;
  writePerUser(all);
}

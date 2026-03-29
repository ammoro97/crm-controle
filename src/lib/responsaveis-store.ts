"use client";

import { useEffect, useMemo, useState } from "react";
import { initialLeads, initialMeetings } from "@/lib/mock-data";

export const RESPONSAVEIS_STORAGE_KEY = "crm.settings.responsaveis.v1";
const RESPONSAVEIS_BOOTSTRAP_KEY = "crm.settings.responsaveis.bootstrapped.v1";
const RESPONSAVEIS_EVENT = "crm:responsaveis:changed";

export type ResponsavelTipo = "vendedor" | "gestor";

export type ResponsavelRecord = {
  id: string;
  nome: string;
  tipo: ResponsavelTipo;
  email?: string;
};

function normalizeNome(value: string): string {
  return value.trim();
}

function normalizeNomeKey(value: string): string {
  return normalizeNome(value).toLowerCase();
}

function normalizeTipo(value?: string): ResponsavelTipo {
  return value === "gestor" ? "gestor" : "vendedor";
}

function normalizeEmail(value?: string): string {
  return String(value || "").trim().toLowerCase();
}

function slugify(value: string): string {
  return normalizeNome(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueResponsaveis(records: ResponsavelRecord[]): ResponsavelRecord[] {
  const byName = new Map<string, ResponsavelRecord>();
  const usedEmails = new Set<string>();
  for (const item of records) {
    const nome = normalizeNome(item.nome);
    if (!nome) continue;
    const key = normalizeNomeKey(nome);
    if (byName.has(key)) continue;
    const normalizedEmail = normalizeEmail(item.email);
    const safeEmail =
      normalizedEmail && !usedEmails.has(normalizedEmail) ? normalizedEmail : undefined;
    if (safeEmail) usedEmails.add(safeEmail);
    byName.set(key, {
      id: item.id || `resp-${slugify(nome)}-${Math.random().toString(36).slice(2, 6)}`,
      nome,
      tipo: normalizeTipo(item.tipo),
      email: safeEmail,
    });
  }
  return Array.from(byName.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

function getFallbackResponsaveis(): ResponsavelRecord[] {
  const names = Array.from(
    new Set([...initialLeads.map((lead) => lead.owner), ...initialMeetings.map((meeting) => meeting.owner)].map((name) => normalizeNome(name)).filter(Boolean)),
  );
  return names
    .map((nome, index) => ({
      id: `resp-fallback-${index + 1}-${slugify(nome)}`,
      nome,
      tipo: "vendedor" as const,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

function parseStoredResponsaveis(raw: string | null): ResponsavelRecord[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;

    const mapped = parsed.map((item, index) => {
      if (typeof item === "string") {
        return {
          id: `resp-migrated-${index + 1}-${slugify(item)}`,
          nome: normalizeNome(item),
          tipo: "vendedor" as const,
        };
      }

      if (!item || typeof item !== "object") {
        return {
          id: `resp-invalid-${index + 1}`,
          nome: "",
          tipo: "vendedor" as const,
        };
      }

      const record = item as Partial<ResponsavelRecord> & { name?: string };
      const nome = normalizeNome(String(record.nome || record.name || ""));
      return {
        id: String(record.id || `resp-${index + 1}-${slugify(nome || `item-${index + 1}`)}`),
      nome,
      tipo: normalizeTipo(record.tipo),
      email: normalizeEmail((record as { email?: string }).email),
    };
  });

    return uniqueResponsaveis(mapped);
  } catch {
    return null;
  }
}

function persistRecords(next: ResponsavelRecord[]) {
  if (typeof window === "undefined") return;
  const normalized = uniqueResponsaveis(next);
  window.localStorage.setItem(RESPONSAVEIS_STORAGE_KEY, JSON.stringify(normalized));
  window.localStorage.setItem(RESPONSAVEIS_BOOTSTRAP_KEY, "1");
  window.dispatchEvent(new CustomEvent(RESPONSAVEIS_EVENT, { detail: normalized }));
}

export function getResponsaveisRecordsSnapshot(): ResponsavelRecord[] {
  if (typeof window === "undefined") return getFallbackResponsaveis();

  const raw = window.localStorage.getItem(RESPONSAVEIS_STORAGE_KEY);
  const bootstrapped = window.localStorage.getItem(RESPONSAVEIS_BOOTSTRAP_KEY) === "1";
  const parsed = parseStoredResponsaveis(raw);

  if (parsed && parsed.length > 0) return parsed;
  if (parsed && parsed.length === 0 && bootstrapped) return [];
  if (bootstrapped && !raw) return [];
  return getFallbackResponsaveis();
}

export function getResponsaveisSnapshot(): string[] {
  return getResponsaveisRecordsSnapshot().map((item) => item.nome);
}

export function setResponsaveis(next: string[]) {
  const normalized: ResponsavelRecord[] = next.map((nome, index) => ({
    id: `resp-set-${index + 1}-${slugify(nome)}`,
    nome: normalizeNome(nome),
    tipo: "vendedor",
    email: "",
  }));
  persistRecords(normalized);
}

export function addResponsavel(
  input: string | { nome: string; tipo?: ResponsavelTipo; email?: string },
) {
  const current = getResponsaveisRecordsSnapshot();
  const nome = typeof input === "string" ? input : input.nome;
  const tipo = typeof input === "string" ? "vendedor" : normalizeTipo(input.tipo);
  const email = typeof input === "string" ? "" : normalizeEmail(input.email);
  const next: ResponsavelRecord = {
    id: `resp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nome: normalizeNome(nome),
    tipo,
    email,
  };
  persistRecords([...current, next]);
}

export function updateResponsavel(
  id: string,
  input: { nome: string; tipo: ResponsavelTipo; email?: string },
) {
  const current = getResponsaveisRecordsSnapshot();
  const next = current.map((item) =>
    item.id === id
      ? {
          ...item,
          nome: normalizeNome(input.nome),
          tipo: normalizeTipo(input.tipo),
          email: normalizeEmail(input.email),
        }
      : item,
  );
  persistRecords(next);
}

export function removeResponsavel(nameOrId: string) {
  const current = getResponsaveisRecordsSnapshot();
  const normalized = normalizeNomeKey(nameOrId);
  const next = current.filter(
    (item) => item.id !== nameOrId && normalizeNomeKey(item.nome) !== normalized,
  );
  persistRecords(next);
}

export function useResponsaveis(includeTodos = false) {
  const [responsaveis, setResponsaveisState] = useState<string[]>(() => getResponsaveisSnapshot());

  useEffect(() => {
    const sync = () => setResponsaveisState(getResponsaveisSnapshot());
    const onStorage = (event: StorageEvent) => {
      if (event.key === RESPONSAVEIS_STORAGE_KEY) sync();
    };

    sync();
    window.addEventListener(RESPONSAVEIS_EVENT, sync);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(RESPONSAVEIS_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return useMemo(
    () => (includeTodos ? ["Todos", ...responsaveis] : responsaveis),
    [includeTodos, responsaveis],
  );
}

export function useResponsaveisRecords() {
  const [records, setRecords] = useState<ResponsavelRecord[]>(() => getResponsaveisRecordsSnapshot());

  useEffect(() => {
    const sync = () => setRecords(getResponsaveisRecordsSnapshot());
    const onStorage = (event: StorageEvent) => {
      if (event.key === RESPONSAVEIS_STORAGE_KEY) sync();
    };

    sync();
    window.addEventListener(RESPONSAVEIS_EVENT, sync);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(RESPONSAVEIS_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return records;
}

export function getResponsavelByEmailSnapshot(email?: string | null): ResponsavelRecord | null {
  const normalized = normalizeEmail(email || "");
  if (!normalized) return null;
  const records = getResponsaveisRecordsSnapshot();
  return records.find((item) => normalizeEmail(item.email) === normalized) || null;
}

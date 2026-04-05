"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-client";

const RESPONSAVEIS_EVENT = "crm:responsaveis:changed";
const RESPONSAVEIS_TABLE = "crm_responsaveis";

export type ResponsavelTipo = "vendedor" | "gestor";

export type ResponsavelRecord = {
  id: string;
  nome: string;
  tipo: ResponsavelTipo;
  email?: string;
  authUserId?: string;
};

let responsaveisCache: ResponsavelRecord[] = [];
let responsaveisLoaded = false;
let responsaveisLoadPromise: Promise<ResponsavelRecord[]> | null = null;

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

function isMissingAuthUserIdColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").toLowerCase();
  return code === "42703" || message.includes("auth_user_id");
}

function toRecord(raw: Record<string, unknown>): ResponsavelRecord | null {
  const id = String(raw.id || "").trim();
  const nome = normalizeNome(String(raw.nome || ""));
  if (!id || !nome) return null;
  const tipo = normalizeTipo(String(raw.tipo || ""));
  const email = normalizeEmail(String(raw.email || ""));
  const authUserId = String(raw.auth_user_id || "").trim();
  return {
    id,
    nome,
    tipo,
    email: email || undefined,
    authUserId: authUserId || undefined,
  };
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
    const safeEmail = normalizedEmail && !usedEmails.has(normalizedEmail) ? normalizedEmail : undefined;
    if (safeEmail) usedEmails.add(safeEmail);

    byName.set(key, {
      id: String(item.id || "").trim(),
      nome,
      tipo: normalizeTipo(item.tipo),
      email: safeEmail,
      authUserId: String(item.authUserId || "").trim() || undefined,
    });
  }

  return Array.from(byName.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

function publishResponsaveis(records: ResponsavelRecord[]) {
  responsaveisCache = uniqueResponsaveis(records);
  responsaveisLoaded = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(RESPONSAVEIS_EVENT, { detail: responsaveisCache }));
  }
}

async function fetchResponsaveisFromSupabase(): Promise<ResponsavelRecord[]> {
  let data: unknown[] | null = null;

  const withAuth = await supabase
    .from(RESPONSAVEIS_TABLE)
    .select("id, nome, tipo, email, auth_user_id")
    .order("nome", { ascending: true });

  if (withAuth.error && isMissingAuthUserIdColumn(withAuth.error)) {
    const legacy = await supabase
      .from(RESPONSAVEIS_TABLE)
      .select("id, nome, tipo, email")
      .order("nome", { ascending: true });
    if (legacy.error) {
      throw new Error(legacy.error.message || "Nao foi possivel carregar responsaveis.");
    }
    data = Array.isArray(legacy.data) ? (legacy.data as unknown[]) : [];
  } else if (withAuth.error) {
    throw new Error(withAuth.error.message || "Nao foi possivel carregar responsaveis.");
  } else {
    data = Array.isArray(withAuth.data) ? (withAuth.data as unknown[]) : [];
  }

  const parsed = Array.isArray(data)
    ? data.map((item) => toRecord(item as Record<string, unknown>)).filter((item): item is ResponsavelRecord => Boolean(item))
    : [];

  return uniqueResponsaveis(parsed);
}

export async function reloadResponsaveisGlobal(): Promise<ResponsavelRecord[]> {
  const records = await fetchResponsaveisFromSupabase();
  publishResponsaveis(records);
  return records;
}

async function ensureResponsaveisLoaded(): Promise<ResponsavelRecord[]> {
  if (responsaveisLoaded) return responsaveisCache;

  if (!responsaveisLoadPromise) {
    responsaveisLoadPromise = reloadResponsaveisGlobal()
      .catch(() => {
        publishResponsaveis([]);
        return [];
      })
      .finally(() => {
        responsaveisLoadPromise = null;
      });
  }

  return responsaveisLoadPromise;
}

export function getResponsaveisRecordsSnapshot(): ResponsavelRecord[] {
  return [...responsaveisCache];
}

export function getResponsaveisSnapshot(): string[] {
  return getResponsaveisRecordsSnapshot().map((item) => item.nome);
}

export function setResponsaveis(_next: string[]) {
  throw new Error("setResponsaveis descontinuado. Use add/update/remove com persistencia global.");
}

export async function addResponsavel(
  input: string | { nome: string; tipo?: ResponsavelTipo; email?: string },
) {
  const nome = typeof input === "string" ? normalizeNome(input) : normalizeNome(input.nome);
  const tipo = typeof input === "string" ? "vendedor" : normalizeTipo(input.tipo);
  const email = typeof input === "string" ? "" : normalizeEmail(input.email);

  const { data, error } = await supabase
    .from(RESPONSAVEIS_TABLE)
    .insert({
      nome,
      tipo,
      email: email || null,
    })
    .select("id")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Nao foi possivel adicionar responsavel.");
  }

  const insertedId = String((data as Record<string, unknown> | null)?.id || "").trim();
  if (insertedId) {
    await syncResponsavelAuthLink(insertedId);
  }

  await reloadResponsaveisGlobal();
}

export async function updateResponsavel(
  id: string,
  input: { nome: string; tipo: ResponsavelTipo; email?: string },
) {
  const { error } = await supabase
    .from(RESPONSAVEIS_TABLE)
    .update({
      nome: normalizeNome(input.nome),
      tipo: normalizeTipo(input.tipo),
      email: normalizeEmail(input.email) || null,
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message || "Nao foi possivel atualizar responsavel.");
  }

  await syncResponsavelAuthLink(id);
  await reloadResponsaveisGlobal();
}

export async function removeResponsavel(nameOrId: string) {
  const target = String(nameOrId || "").trim();
  if (!target) return;

  let query = supabase.from(RESPONSAVEIS_TABLE).delete();
  const byId = responsaveisCache.find((item) => item.id === target);
  if (byId) {
    query = query.eq("id", target);
  } else {
    query = query.eq("nome", target);
  }

  const { error } = await query;
  if (error) {
    throw new Error(error.message || "Nao foi possivel excluir responsavel.");
  }

  await reloadResponsaveisGlobal();
}

export function useResponsaveis(includeTodos = false) {
  const [responsaveis, setResponsaveisState] = useState<string[]>(() => getResponsaveisSnapshot());

  useEffect(() => {
    const sync = () => setResponsaveisState(getResponsaveisSnapshot());
    const bootstrap = async () => {
      await ensureResponsaveisLoaded();
      sync();
    };

    void bootstrap();
    window.addEventListener(RESPONSAVEIS_EVENT, sync);
    return () => {
      window.removeEventListener(RESPONSAVEIS_EVENT, sync);
    };
  }, []);

  return useMemo(() => (includeTodos ? ["Todos", ...responsaveis] : responsaveis), [includeTodos, responsaveis]);
}

export function useResponsaveisRecords() {
  const [records, setRecords] = useState<ResponsavelRecord[]>(() => getResponsaveisRecordsSnapshot());

  useEffect(() => {
    const sync = () => setRecords(getResponsaveisRecordsSnapshot());
    const bootstrap = async () => {
      await ensureResponsaveisLoaded();
      sync();
    };

    void bootstrap();
    window.addEventListener(RESPONSAVEIS_EVENT, sync);
    return () => {
      window.removeEventListener(RESPONSAVEIS_EVENT, sync);
    };
  }, []);

  return records;
}

export async function getResponsavelByEmail(email?: string | null): Promise<ResponsavelRecord | null> {
  const normalized = normalizeEmail(email || "");
  if (!normalized) return null;

  const withAuth = await supabase
    .from(RESPONSAVEIS_TABLE)
    .select("id, nome, tipo, email, auth_user_id")
    .eq("email", normalized)
    .limit(1)
    .maybeSingle();

  let data: unknown = withAuth.data as unknown;
  let error: { code?: string; message?: string } | null = withAuth.error
    ? { code: withAuth.error.code, message: withAuth.error.message }
    : null;

  if (error && isMissingAuthUserIdColumn(error)) {
    const legacy = await supabase
      .from(RESPONSAVEIS_TABLE)
      .select("id, nome, tipo, email")
      .eq("email", normalized)
      .limit(1)
      .maybeSingle();
    data = legacy.data as unknown;
    error = legacy.error ? { code: legacy.error.code, message: legacy.error.message } : null;
  }

  if (!error && data) {
    const parsed = toRecord(data as Record<string, unknown>);
    if (parsed) return parsed;
  }

  await ensureResponsaveisLoaded();
  return responsaveisCache.find((item) => normalizeEmail(item.email) === normalized) || null;
}

export function getResponsavelByEmailSnapshot(email?: string | null): ResponsavelRecord | null {
  const normalized = normalizeEmail(email || "");
  if (!normalized) return null;
  return responsaveisCache.find((item) => normalizeEmail(item.email) === normalized) || null;
}

async function syncResponsavelAuthLink(responsavelId: string) {
  const targetId = String(responsavelId || "").trim();
  if (!targetId) return;
  try {
    await fetch("/api/responsaveis/sync-auth-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responsavelId: targetId }),
    });
  } catch {
    // Sync de auth_user_id e best-effort para nao bloquear fluxo principal.
  }
}

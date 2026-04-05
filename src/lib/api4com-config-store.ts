import { randomUUID } from "crypto";
import { readDataFile, writeDataFile } from "./storage-paths";
import type { Api4Integracao, StatusIntegracao } from "@/types/integrations";

export type Api4ComConfig = {
  integrationId: string | null;
  nome: string;
  token: string;
  extension: string;
  gateway: string;
  status: StatusIntegracao;
  isConnected: boolean;
  responsavelId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Api4ComPublicConfig = {
  integrationId: string | null;
  nome: string;
  tokenMasked: string;
  hasToken: boolean;
  extension: string;
  gateway: string;
  status: StatusIntegracao;
  isConnected: boolean;
  responsavelId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type Api4ComIntegracaoPublic = {
  id: string;
  nome: string;
  ramal: string;
  gateway: string;
  tokenMasked: string;
  hasToken: boolean;
  status: StatusIntegracao;
  isConnected: boolean;
  responsavelId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isPrimary: boolean;
};

type Api4ComIntegracoesStorage = {
  version: 2;
  selectedId: string | null;
  items: Api4Integracao[];
};

type LegacyApi4ComConfig = {
  token?: string;
  extension?: string;
  gateway?: string;
  isConnected?: boolean;
  updatedAt?: string;
};

type CreateApi4ComIntegracaoInput = {
  nome: string;
  ramal: string;
  gateway?: string | null;
  token?: string | null;
  status?: StatusIntegracao;
  responsavelId?: string | null;
  baseIntegrationId?: string | null;
  setAsPrimary?: boolean;
};

type UpdateApi4ComIntegracaoInput = {
  id: string;
  nome?: string;
  ramal?: string;
  gateway?: string | null;
  token?: string | null;
  status?: StatusIntegracao;
  responsavelId?: string | null;
  setAsPrimary?: boolean;
};

export type Api4ComIntegracaoTemplate = {
  baseIntegrationId: string | null;
  nomeBase: string;
  gateway: string;
  hasToken: boolean;
  tokenMasked: string;
};

const LEGACY_FILENAME = "api4com-config.json";
const STORAGE_FILENAME = "api4com-integracoes.json";

const EMPTY_CONFIG: Api4ComConfig = {
  integrationId: null,
  nome: "",
  token: "",
  extension: "",
  gateway: "",
  status: "inativo",
  isConnected: false,
  responsavelId: null,
  createdAt: "",
  updatedAt: "",
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeNullableText(value: unknown): string | null {
  const parsed = normalizeText(value);
  return parsed || null;
}

function normalizeStatus(value: unknown, fallback: StatusIntegracao = "inativo"): StatusIntegracao {
  const parsed = normalizeText(value).toLowerCase();
  if (parsed === "ativo") return "ativo";
  if (parsed === "inativo") return "inativo";
  if (parsed === "erro") return "erro";
  return fallback;
}

function isConnectedFromStatus(status: StatusIntegracao): boolean {
  return status === "ativo";
}

function hasAnyLegacyValue(config: LegacyApi4ComConfig): boolean {
  return Boolean(
    normalizeText(config.token) ||
      normalizeText(config.extension) ||
      normalizeText(config.gateway) ||
      normalizeText(config.updatedAt) ||
      config.isConnected,
  );
}

function normalizeIsoDate(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function safeId(value: unknown, fallbackSeed: string): string {
  const raw = normalizeText(value);
  if (raw) return raw;
  const cleanedSeed = normalizeText(fallbackSeed).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return cleanedSeed ? `api4-${cleanedSeed}` : randomUUID();
}

function toIntegration(raw: Partial<Api4Integracao> | null | undefined, fallbackSeed: string): Api4Integracao {
  const now = new Date().toISOString();
  const createdAt = normalizeIsoDate(raw?.createdAt) || normalizeIsoDate(raw?.updatedAt) || now;
  const updatedAt = normalizeIsoDate(raw?.updatedAt) || createdAt;
  const fallbackStatus = raw?.status ? normalizeStatus(raw.status) : "inativo";
  const normalizedStatus = normalizeStatus(raw?.status, fallbackStatus);

  return {
    id: safeId(raw?.id, fallbackSeed),
    nome: normalizeText(raw?.nome),
    ramal: normalizeText(raw?.ramal),
    gateway: normalizeNullableText(raw?.gateway),
    token: normalizeNullableText(raw?.token),
    status: normalizedStatus,
    responsavelId: normalizeNullableText(raw?.responsavelId),
    createdAt,
    updatedAt,
  };
}

function toIntegrationFromLegacy(config: LegacyApi4ComConfig): Api4Integracao {
  const now = new Date().toISOString();
  const updatedAt = normalizeIsoDate(config.updatedAt) || now;
  const status: StatusIntegracao = config.isConnected ? "ativo" : "inativo";
  const ramal = normalizeText(config.extension);
  const nome = ramal ? `API4COM - Ramal ${ramal}` : "API4COM - Principal";
  return {
    id: safeId("", `legacy-${ramal || "principal"}`),
    nome,
    ramal,
    gateway: normalizeNullableText(config.gateway),
    token: normalizeNullableText(config.token),
    status,
    responsavelId: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

async function readLegacyConfig(): Promise<LegacyApi4ComConfig | null> {
  const raw = await readDataFile<LegacyApi4ComConfig>(LEGACY_FILENAME, {});
  if (!hasAnyLegacyValue(raw)) return null;
  return raw;
}

function sanitizeStorage(raw: unknown): Api4ComIntegracoesStorage {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sourceItems = Array.isArray(source.items) ? source.items : Array.isArray(raw) ? raw : [];

  const items = sourceItems
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const parsed = toIntegration(item as Partial<Api4Integracao>, `item-${index}`);
      if (!parsed.nome && !parsed.ramal && !parsed.gateway && !parsed.token) return null;
      if (!parsed.nome) parsed.nome = parsed.ramal ? `API4COM - Ramal ${parsed.ramal}` : "API4COM";
      return parsed;
    })
    .filter((item): item is Api4Integracao => Boolean(item));

  const selectedIdRaw = normalizeText(source.selectedId);
  const selectedId = items.some((item) => item.id === selectedIdRaw)
    ? selectedIdRaw
    : items.length > 0
      ? items[0].id
      : null;

  return {
    version: 2,
    selectedId,
    items,
  };
}

async function readStorage(): Promise<Api4ComIntegracoesStorage> {
  const raw = await readDataFile<unknown>(STORAGE_FILENAME, null);
  const parsed = sanitizeStorage(raw);
  if (parsed.items.length > 0) {
    return parsed;
  }

  const legacy = await readLegacyConfig();
  if (!legacy) {
    return parsed;
  }

  const migrated = toIntegrationFromLegacy(legacy);
  const migratedStorage: Api4ComIntegracoesStorage = {
    version: 2,
    selectedId: migrated.id,
    items: [migrated],
  };

  await writeDataFile(STORAGE_FILENAME, migratedStorage);
  return migratedStorage;
}

async function persistStorage(input: Api4ComIntegracoesStorage): Promise<Api4ComIntegracoesStorage> {
  const normalized = sanitizeStorage(input);
  await writeDataFile(STORAGE_FILENAME, normalized);
  return normalized;
}

function toLegacyConfig(integration: Api4Integracao | null): Api4ComConfig {
  if (!integration) return { ...EMPTY_CONFIG };
  return {
    integrationId: integration.id,
    nome: integration.nome,
    token: normalizeText(integration.token),
    extension: integration.ramal,
    gateway: normalizeText(integration.gateway),
    status: integration.status,
    isConnected: isConnectedFromStatus(integration.status),
    responsavelId: integration.responsavelId,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}

function pickPrimaryIntegration(storage: Api4ComIntegracoesStorage): Api4Integracao | null {
  if (storage.items.length === 0) return null;
  const selected = storage.selectedId ? storage.items.find((item) => item.id === storage.selectedId) || null : null;
  const active = storage.items.find((item) => item.status === "ativo") || null;

  const isDialReady = (item: Api4Integracao | null) => {
    if (!item) return false;
    return Boolean(normalizeText(item.token) && normalizeText(item.ramal));
  };

  if (isDialReady(selected)) return selected;
  if (isDialReady(active)) return active;

  const firstDialReady = storage.items.find((item) => isDialReady(item)) || null;
  if (firstDialReady) return firstDialReady;

  if (selected) return selected;
  if (active) return active;
  return storage.items[0] || null;
}

function mergeIntegration(
  current: Api4Integracao,
  input: Omit<UpdateApi4ComIntegracaoInput, "id" | "setAsPrimary">,
): Api4Integracao {
  const now = new Date().toISOString();
  const nextNome = input.nome !== undefined ? normalizeText(input.nome) : current.nome;
  const nextRamal = input.ramal !== undefined ? normalizeText(input.ramal) : current.ramal;

  const nextGateway =
    input.gateway !== undefined
      ? normalizeNullableText(input.gateway)
      : current.gateway;

  const rawTokenInput = input.token !== undefined ? normalizeText(input.token) : undefined;
  const nextToken = rawTokenInput !== undefined && rawTokenInput ? rawTokenInput : current.token;

  const nextStatus = input.status !== undefined ? normalizeStatus(input.status, current.status) : current.status;
  const nextResponsavelId =
    input.responsavelId !== undefined ? normalizeNullableText(input.responsavelId) : current.responsavelId;

  return {
    ...current,
    nome: nextNome || current.nome,
    ramal: nextRamal || current.ramal,
    gateway: nextGateway,
    token: nextToken,
    status: nextStatus,
    responsavelId: nextResponsavelId,
    updatedAt: now,
  };
}

function pickBaseIntegration(storage: Api4ComIntegracoesStorage, baseIntegrationId?: string | null): Api4Integracao | null {
  const baseId = normalizeText(baseIntegrationId);
  if (baseId) {
    const byId = storage.items.find((item) => item.id === baseId);
    if (byId) return byId;
  }
  return pickPrimaryIntegration(storage);
}

export function maskToken(token: string): string {
  const cleaned = token.trim();
  if (!cleaned) return "Nao configurado";
  if (cleaned.length <= 4) return "*".repeat(cleaned.length);
  const suffix = cleaned.slice(-4);
  return `${"*".repeat(Math.max(8, cleaned.length - 4))}${suffix}`;
}

export function toPublicApi4ComConfig(config: Api4ComConfig): Api4ComPublicConfig {
  return {
    integrationId: config.integrationId,
    nome: config.nome,
    tokenMasked: maskToken(config.token),
    hasToken: Boolean(config.token.trim()),
    extension: config.extension,
    gateway: config.gateway,
    status: config.status,
    isConnected: config.isConnected,
    responsavelId: config.responsavelId,
    createdAt: config.createdAt || null,
    updatedAt: config.updatedAt || null,
  };
}

export function toPublicApi4ComIntegracao(
  integration: Api4Integracao,
  selectedId: string | null,
): Api4ComIntegracaoPublic {
  return {
    id: integration.id,
    nome: integration.nome,
    ramal: integration.ramal,
    gateway: normalizeText(integration.gateway),
    tokenMasked: maskToken(normalizeText(integration.token)),
    hasToken: Boolean(normalizeText(integration.token)),
    status: integration.status,
    isConnected: isConnectedFromStatus(integration.status),
    responsavelId: integration.responsavelId,
    createdAt: integration.createdAt || null,
    updatedAt: integration.updatedAt || null,
    isPrimary: selectedId === integration.id,
  };
}

export async function listApi4ComIntegracoes(): Promise<Api4Integracao[]> {
  const storage = await readStorage();
  return storage.items;
}

export async function listPublicApi4ComIntegracoes(): Promise<Api4ComIntegracaoPublic[]> {
  const storage = await readStorage();
  return storage.items.map((item) => toPublicApi4ComIntegracao(item, storage.selectedId));
}

export async function getApi4ComIntegracaoById(id: string): Promise<Api4Integracao | null> {
  const targetId = normalizeText(id);
  if (!targetId) return null;
  const storage = await readStorage();
  return storage.items.find((item) => item.id === targetId) || null;
}

export async function getActiveApi4ComIntegracao(): Promise<Api4Integracao | null> {
  const storage = await readStorage();
  return pickPrimaryIntegration(storage);
}

export async function resolveApi4ComIntegracaoForResponsavel(
  responsavelId?: string | null,
): Promise<Api4Integracao | null> {
  const normalizedResponsavelId = normalizeText(responsavelId);
  const storage = await readStorage();
  const isDialReady = (item: Api4Integracao | null) => {
    if (!item) return false;
    return Boolean(normalizeText(item.token) && normalizeText(item.ramal));
  };

  if (normalizedResponsavelId) {
    const byResponsavel =
      storage.items.find(
        (item) => normalizeText(item.responsavelId) === normalizedResponsavelId && isDialReady(item),
      ) ||
      storage.items.find((item) => normalizeText(item.responsavelId) === normalizedResponsavelId) ||
      null;
    if (byResponsavel && isDialReady(byResponsavel)) return byResponsavel;
  }

  const primary = pickPrimaryIntegration(storage);
  if (isDialReady(primary)) return primary;

  const activeReady = storage.items.find((item) => item.status === "ativo" && isDialReady(item)) || null;
  if (activeReady) return activeReady;

  const anyReady = storage.items.find((item) => isDialReady(item)) || null;
  if (anyReady) return anyReady;

  return primary;
}

export async function createApi4ComIntegracao(input: CreateApi4ComIntegracaoInput): Promise<Api4Integracao> {
  const storage = await readStorage();
  const base = pickBaseIntegration(storage, input.baseIntegrationId);
  const now = new Date().toISOString();

  const nome = normalizeText(input.nome) || (base?.nome ? `${base.nome} copia` : "API4COM");
  const ramal = normalizeText(input.ramal);
  const gatewayInput = normalizeNullableText(input.gateway);
  const tokenInput = normalizeText(input.token);
  const status = normalizeStatus(input.status, base?.status || "inativo");

  const next: Api4Integracao = {
    id: randomUUID(),
    nome,
    ramal,
    gateway: gatewayInput ?? base?.gateway ?? null,
    token: tokenInput || base?.token || null,
    status,
    responsavelId: normalizeNullableText(input.responsavelId),
    createdAt: now,
    updatedAt: now,
  };

  const nextStorage: Api4ComIntegracoesStorage = {
    ...storage,
    items: [...storage.items, next],
    selectedId: input.setAsPrimary || !storage.selectedId ? next.id : storage.selectedId,
  };

  await persistStorage(nextStorage);
  return next;
}

export async function updateApi4ComIntegracao(input: UpdateApi4ComIntegracaoInput): Promise<Api4Integracao | null> {
  const targetId = normalizeText(input.id);
  if (!targetId) return null;

  const storage = await readStorage();
  const index = storage.items.findIndex((item) => item.id === targetId);
  if (index < 0) return null;

  const current = storage.items[index];
  const updated = mergeIntegration(current, input);
  const items = [...storage.items];
  items[index] = updated;

  const nextStorage: Api4ComIntegracoesStorage = {
    ...storage,
    items,
    selectedId: input.setAsPrimary ? updated.id : storage.selectedId || updated.id,
  };

  await persistStorage(nextStorage);
  return updated;
}

export async function setApi4ComIntegracaoPrimary(id: string): Promise<Api4Integracao | null> {
  const targetId = normalizeText(id);
  if (!targetId) return null;
  const storage = await readStorage();
  const target = storage.items.find((item) => item.id === targetId) || null;
  if (!target) return null;
  await persistStorage({
    ...storage,
    selectedId: target.id,
  });
  return target;
}

export async function updateApi4ComIntegracaoStatus(
  id: string,
  status: StatusIntegracao,
): Promise<Api4Integracao | null> {
  const targetId = normalizeText(id);
  if (!targetId) return null;
  const storage = await readStorage();
  const index = storage.items.findIndex((item) => item.id === targetId);
  if (index < 0) return null;
  const target = storage.items[index];
  const updated: Api4Integracao = {
    ...target,
    status: normalizeStatus(status, target.status),
    updatedAt: new Date().toISOString(),
  };
  const items = [...storage.items];
  items[index] = updated;
  await persistStorage({ ...storage, items });
  return updated;
}

export async function getApi4ComIntegracaoTemplate(): Promise<Api4ComIntegracaoTemplate> {
  const primary = await getActiveApi4ComIntegracao();
  return {
    baseIntegrationId: primary?.id || null,
    nomeBase: primary?.nome || "API4COM",
    gateway: normalizeText(primary?.gateway),
    hasToken: Boolean(normalizeText(primary?.token)),
    tokenMasked: maskToken(normalizeText(primary?.token)),
  };
}

// Backward-compatible API used by existing routes/services.
export async function getApi4ComConfig(): Promise<Api4ComConfig> {
  const primary = await getActiveApi4ComIntegracao();
  return toLegacyConfig(primary);
}

// Backward-compatible API used by existing routes/services.
export async function saveApi4ComConfig(input: {
  token?: string;
  extension: string;
  gateway: string;
  nome?: string;
  responsavelId?: string | null;
}): Promise<Api4ComConfig> {
  const storage = await readStorage();
  const current = pickPrimaryIntegration(storage);
  const now = new Date().toISOString();
  const nextToken = normalizeText(input.token);
  const nextRamal = normalizeText(input.extension);
  const nextGateway = normalizeText(input.gateway);
  const nextNome = normalizeText(input.nome) || current?.nome || (nextRamal ? `API4COM - Ramal ${nextRamal}` : "API4COM");

  let updated: Api4Integracao;

  if (current) {
    updated = {
      ...current,
      nome: nextNome,
      ramal: nextRamal,
      gateway: nextGateway || current.gateway,
      token: nextToken || current.token,
      responsavelId:
        input.responsavelId !== undefined ? normalizeNullableText(input.responsavelId) : current.responsavelId,
      status: "inativo",
      updatedAt: now,
    };

    const items = storage.items.map((item) => (item.id === current.id ? updated : item));
    await persistStorage({
      ...storage,
      items,
      selectedId: current.id,
    });
  } else {
    updated = {
      id: randomUUID(),
      nome: nextNome,
      ramal: nextRamal,
      gateway: nextGateway || null,
      token: nextToken || null,
      status: "inativo",
      responsavelId: normalizeNullableText(input.responsavelId),
      createdAt: now,
      updatedAt: now,
    };
    await persistStorage({
      version: 2,
      selectedId: updated.id,
      items: [updated],
    });
  }

  return toLegacyConfig(updated);
}

// Backward-compatible API used by existing routes/services.
export async function updateApi4ComConnectionStatus(
  isConnected: boolean,
  integrationId?: string,
): Promise<Api4ComConfig> {
  const storage = await readStorage();
  const target =
    (integrationId ? storage.items.find((item) => item.id === normalizeText(integrationId)) : null) ||
    pickPrimaryIntegration(storage);

  if (!target) return { ...EMPTY_CONFIG };

  const updated: Api4Integracao = {
    ...target,
    status: isConnected ? "ativo" : "inativo",
    updatedAt: new Date().toISOString(),
  };

  const items = storage.items.map((item) => (item.id === target.id ? updated : item));
  await persistStorage({
    ...storage,
    items,
    selectedId: storage.selectedId || updated.id,
  });

  return toLegacyConfig(updated);
}

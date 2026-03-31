import { readDataFile, writeDataFile } from "./storage-paths";

export type Api4ComConfig = {
  token: string;
  extension: string;
  gateway: string;
  isConnected: boolean;
  updatedAt: string;
};

export type Api4ComPublicConfig = {
  tokenMasked: string;
  hasToken: boolean;
  extension: string;
  gateway: string;
  isConnected: boolean;
  updatedAt: string | null;
};

const FILENAME = "api4com-config.json";

const DEFAULT_CONFIG: Api4ComConfig = {
  token: "",
  extension: "",
  gateway: "",
  isConnected: false,
  updatedAt: "",
};

function normalizeConfig(raw: Partial<Api4ComConfig> | null | undefined): Api4ComConfig {
  return {
    token: (raw?.token || "").trim(),
    extension: (raw?.extension || "").trim(),
    gateway: (raw?.gateway || "").trim(),
    isConnected: Boolean(raw?.isConnected),
    updatedAt: (raw?.updatedAt || "").trim(),
  };
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
    tokenMasked: maskToken(config.token),
    hasToken: Boolean(config.token.trim()),
    extension: config.extension,
    gateway: config.gateway,
    isConnected: config.isConnected,
    updatedAt: config.updatedAt || null,
  };
}

export async function getApi4ComConfig(): Promise<Api4ComConfig> {
  const raw = await readDataFile<Partial<Api4ComConfig>>(FILENAME, {});
  return normalizeConfig(raw);
}

export async function saveApi4ComConfig(input: {
  token?: string;
  extension: string;
  gateway: string;
}): Promise<Api4ComConfig> {
  const current = await getApi4ComConfig();
  const nextToken = typeof input.token === "string" ? input.token.trim() : current.token;

  const next: Api4ComConfig = {
    token: nextToken,
    extension: input.extension.trim(),
    gateway: input.gateway.trim(),
    isConnected: false,
    updatedAt: new Date().toISOString(),
  };

  await writeDataFile(FILENAME, next);
  return next;
}

export async function updateApi4ComConnectionStatus(isConnected: boolean): Promise<Api4ComConfig> {
  const current = await getApi4ComConfig();
  const next: Api4ComConfig = {
    ...current,
    isConnected,
    updatedAt: new Date().toISOString(),
  };
  await writeDataFile(FILENAME, next);
  return next;
}

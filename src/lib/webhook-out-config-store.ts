import { promises as fs } from "fs";
import path from "path";

export type WebhookOutMethod = "POST";

export type WebhookOutConfig = {
  url: string;
  secret: string;
  method: WebhookOutMethod;
  enabled: boolean;
  updatedAt: string;
};

export type WebhookOutPublicConfig = {
  url: string;
  hasSecret: boolean;
  secretMasked: string;
  method: WebhookOutMethod;
  enabled: boolean;
  updatedAt: string | null;
};

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_PATH = path.join(DATA_DIR, "webhook-out-config.json");

const DEFAULT_CONFIG: WebhookOutConfig = {
  url: "",
  secret: "",
  method: "POST",
  enabled: false,
  updatedAt: "",
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function normalizeUrl(value?: string) {
  const url = String(value || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeMethod(value?: string): WebhookOutMethod {
  const method = String(value || "").trim().toUpperCase();
  if (method === "POST") return "POST";
  return "POST";
}

function normalizeConfig(raw: Partial<WebhookOutConfig> | null | undefined): WebhookOutConfig {
  const url = normalizeUrl(raw?.url);
  return {
    url,
    secret: String(raw?.secret || "").trim(),
    method: normalizeMethod(raw?.method),
    enabled: Boolean(raw?.enabled) && Boolean(url),
    updatedAt: String(raw?.updatedAt || "").trim(),
  };
}

function maskSecret(secret: string) {
  const cleaned = String(secret || "").trim();
  if (!cleaned) return "Nao configurado";
  if (cleaned.length <= 4) return "*".repeat(cleaned.length);
  return `${"*".repeat(Math.max(8, cleaned.length - 4))}${cleaned.slice(-4)}`;
}

export function toPublicWebhookOutConfig(config: WebhookOutConfig): WebhookOutPublicConfig {
  return {
    url: config.url,
    hasSecret: Boolean(config.secret),
    secretMasked: maskSecret(config.secret),
    method: config.method,
    enabled: config.enabled,
    updatedAt: config.updatedAt || null,
  };
}

export async function getWebhookOutConfig(): Promise<WebhookOutConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return normalizeConfig(JSON.parse(raw) as Partial<WebhookOutConfig>);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveWebhookOutConfig(input: {
  url: string;
  secret?: string;
  method?: string;
  enabled?: boolean;
}): Promise<WebhookOutConfig> {
  const current = await getWebhookOutConfig();
  const nextUrl = normalizeUrl(input.url);
  const nextSecret = typeof input.secret === "string" ? input.secret.trim() : current.secret;
  const nextMethod = normalizeMethod(input.method || current.method);
  const enabledRequested = typeof input.enabled === "boolean" ? input.enabled : Boolean(nextUrl);

  const next: WebhookOutConfig = {
    url: nextUrl,
    secret: nextSecret,
    method: nextMethod,
    enabled: enabledRequested && Boolean(nextUrl),
    updatedAt: new Date().toISOString(),
  };

  await ensureDataDir();
  await fs.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function isWebhookOutConfigured(config: WebhookOutConfig) {
  return Boolean(config.enabled && config.url);
}

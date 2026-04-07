import { promises as fs } from "fs";
import path from "path";
import { getSupabaseAdmin } from "./supabase-admin";
import { withTimeout } from "./server/with-timeout";

const STORAGE_READ_TIMEOUT_MS = 8_000;
const STORAGE_WRITE_TIMEOUT_MS = 8_000;

// Storage priority:
// 1. Supabase (persistent)
// 2. /tmp (local fallback for non-critical keys)
// 3. bundled data/ (read-only fallback for non-critical keys)

const BUNDLE_DATA_DIR = path.join(process.cwd(), "data");
const RUNTIME_DATA_DIR = "/tmp/crm-data";
const STORAGE_TABLE = "crm_storage";
const SUPABASE_REQUIRED_PREFIXES = [
  "crm.",
  "call-logs",
  "call-analysis-requests",
  "lead-ai-observations",
  "lead-last-contact-overrides",
];

export function bundlePath(filename: string) {
  return path.join(BUNDLE_DATA_DIR, filename);
}

export function runtimePath(filename: string) {
  return path.join(RUNTIME_DATA_DIR, filename);
}

export async function ensureRuntimeDir() {
  await fs.mkdir(RUNTIME_DATA_DIR, { recursive: true });
}

function toStorageKey(filename: string): string {
  return filename.replace(/\.json$/, "");
}

function requiresSupabasePersistence(key: string): boolean {
  return SUPABASE_REQUIRED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export async function readDataFile<T>(filename: string, fallback: T): Promise<T> {
  const key = toStorageKey(filename);
  const supabaseRequired = requiresSupabasePersistence(key);

  try {
    const admin = getSupabaseAdmin();
    if (!admin) {
      console.warn(`[STORAGE] read key=${key} supabase=SKIP (service role missing)`);
      if (supabaseRequired) return fallback;
    } else {
      const { data, error } = await withTimeout(
        Promise.resolve(
          admin
            .from(STORAGE_TABLE)
            .select("value")
            .eq("key", key)
            .maybeSingle(),
        ),
        STORAGE_READ_TIMEOUT_MS,
        `storage:read:${key}`,
      );

      if (error) {
        console.error(`[STORAGE] read key=${key} supabase=ERROR`, error.message);
        if (supabaseRequired) return fallback;
      } else if (data?.value !== undefined && data.value !== null) {
        console.log(`[STORAGE] read key=${key} source=supabase`);
        return data.value as T;
      } else {
        console.log(`[STORAGE] read key=${key} supabase=EMPTY`);
        if (supabaseRequired) return fallback;
      }
    }
  } catch (err) {
    console.error(`[STORAGE] read key=${key} supabase=EXCEPTION`, err instanceof Error ? err.message : err);
    if (supabaseRequired) return fallback;
  }

  if (supabaseRequired) return fallback;

  try {
    const raw = await fs.readFile(runtimePath(filename), "utf8");
    console.log(`[STORAGE] read key=${key} source=tmp`);
    return JSON.parse(raw) as T;
  } catch {}

  try {
    const raw = await fs.readFile(bundlePath(filename), "utf8");
    console.warn(`[STORAGE] read key=${key} source=bundle`);
    return JSON.parse(raw) as T;
  } catch {}

  console.warn(`[STORAGE] read key=${key} source=fallback_default`);
  return fallback;
}

export async function writeDataFile<T>(filename: string, value: T): Promise<void> {
  const key = toStorageKey(filename);
  const supabaseRequired = requiresSupabasePersistence(key);
  let supabaseOk = false;

  try {
    const admin = getSupabaseAdmin();
    if (!admin) {
      console.warn(`[STORAGE] write key=${key} supabase=SKIP (service role missing)`);
      if (supabaseRequired) {
        throw new Error("SUPABASE_REQUIRED_FOR_STORAGE_WRITE");
      }
    } else {
      const { error } = await withTimeout(
        Promise.resolve(
          admin.from(STORAGE_TABLE).upsert(
            {
              key,
              value,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "key" },
          ),
        ),
        STORAGE_WRITE_TIMEOUT_MS,
        `storage:write:${key}`,
      );
      if (!error) {
        supabaseOk = true;
      } else {
        console.error(
          `[STORAGE] write key=${key} supabase=ERROR`,
          error.message,
          `| code=${error.code} | details=${error.details} | hint=${error.hint}`,
        );
        if (supabaseRequired) {
          throw new Error("SUPABASE_REQUIRED_FOR_STORAGE_WRITE");
        }
      }
    }
  } catch (err) {
    console.error(`[STORAGE] write key=${key} supabase=EXCEPTION`, err instanceof Error ? err.message : err);
    if (supabaseRequired) {
      throw err instanceof Error ? err : new Error("SUPABASE_REQUIRED_FOR_STORAGE_WRITE");
    }
  }

  if (supabaseRequired) return;

  try {
    await ensureRuntimeDir();
    await fs.writeFile(runtimePath(filename), JSON.stringify(value, null, 2), "utf8");
    if (supabaseOk) {
      console.log(`[STORAGE] write ok key=${key} supabase=true tmp=synced`);
    }
  } catch {
    if (!supabaseOk) {
      console.error(`[STORAGE] write failed key=${key} supabase=false tmp=failed`);
    }
  }
}

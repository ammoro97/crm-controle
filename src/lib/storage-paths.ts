import { promises as fs } from "fs";
import path from "path";
import { getSupabaseAdmin } from "./supabase-admin";

// Estrategia de persistencia (ordem de prioridade):
// 1. Supabase (persistente entre instancias e deploys) — requer SUPABASE_SERVICE_ROLE_KEY
// 2. /tmp (efemero, perdido em cold starts — fallback local/dev)
// 3. data/ bundlado (somente leitura, valor inicial de fabrica)

const BUNDLE_DATA_DIR = path.join(process.cwd(), "data");
const RUNTIME_DATA_DIR = "/tmp/crm-data";
const STORAGE_TABLE = "crm_storage";

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

export async function readDataFile<T>(filename: string, fallback: T): Promise<T> {
  // 1. Supabase (fonte de verdade persistente)
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const { data, error } = await admin
        .from(STORAGE_TABLE)
        .select("value")
        .eq("key", toStorageKey(filename))
        .maybeSingle();

      if (!error && data?.value !== undefined && data.value !== null) {
        return data.value as T;
      }
    }
  } catch {
    // Supabase indisponivel — continua para fallbacks
  }

  // 2. /tmp (instancia atual, local dev ou cache quente)
  try {
    const raw = await fs.readFile(runtimePath(filename), "utf8");
    return JSON.parse(raw) as T;
  } catch {}

  // 3. Bundle (somente leitura, valor inicial)
  try {
    const raw = await fs.readFile(bundlePath(filename), "utf8");
    return JSON.parse(raw) as T;
  } catch {}

  return fallback;
}

export async function writeDataFile<T>(filename: string, value: T): Promise<void> {
  let supabaseOk = false;

  // 1. Supabase (persistente)
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const { error } = await admin.from(STORAGE_TABLE).upsert(
        {
          key: toStorageKey(filename),
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
      if (!error) supabaseOk = true;
    }
  } catch {
    // Supabase indisponivel — continua para /tmp
  }

  // 2. /tmp (fallback local/dev)
  // Quando Supabase esta disponivel, sincroniza /tmp com o mesmo valor para
  // evitar que instancias serverless retornem dado stale no fallback.
  try {
    await ensureRuntimeDir();
    await fs.writeFile(runtimePath(filename), JSON.stringify(value, null, 2), "utf8");
    if (supabaseOk) {
      console.log(`[STORAGE] write ok — supabase=true tmp=synced key=${toStorageKey(filename)}`);
    }
  } catch {
    if (!supabaseOk) {
      console.error(`[STORAGE] write failed — supabase=false tmp=failed key=${toStorageKey(filename)}`);
    }
  }
}

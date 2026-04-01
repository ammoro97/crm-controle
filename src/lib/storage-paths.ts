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
  const key = toStorageKey(filename);

  // 1. Supabase (fonte de verdade persistente)
  try {
    const admin = getSupabaseAdmin();
    if (!admin) {
      console.warn(`[STORAGE] read key=${key} supabase=SKIP (cliente nulo — SUPABASE_SERVICE_ROLE_KEY ausente?)`);
    } else {
      const { data, error } = await admin
        .from(STORAGE_TABLE)
        .select("value")
        .eq("key", key)
        .maybeSingle();

      if (error) {
        console.error(`[STORAGE] read key=${key} supabase=ERROR`, error.message);
      } else if (data?.value !== undefined && data.value !== null) {
        console.log(`[STORAGE] read key=${key} source=supabase`);
        return data.value as T;
      } else {
        console.log(`[STORAGE] read key=${key} supabase=EMPTY (sem registro — tabela crm_storage existe?)`);
      }
    }
  } catch (err) {
    console.error(`[STORAGE] read key=${key} supabase=EXCEPTION`, err instanceof Error ? err.message : err);
  }

  // 2. /tmp (instancia atual, local dev ou cache quente)
  try {
    const raw = await fs.readFile(runtimePath(filename), "utf8");
    console.log(`[STORAGE] read key=${key} source=tmp`);
    return JSON.parse(raw) as T;
  } catch {}

  // 3. Bundle (somente leitura, valor inicial)
  try {
    const raw = await fs.readFile(bundlePath(filename), "utf8");
    console.warn(`[STORAGE] read key=${key} source=BUNDLE (valor de fabrica — supabase e tmp indisponiveis)`);
    return JSON.parse(raw) as T;
  } catch {}

  console.warn(`[STORAGE] read key=${key} source=FALLBACK_DEFAULT`);
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

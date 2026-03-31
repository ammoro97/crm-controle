import { promises as fs } from "fs";
import path from "path";

// No Vercel, process.cwd()/data/ e somente leitura (bundle do deploy).
// /tmp e a unica pasta gravavel, mas e efemera (perdida em cold starts).
// Estrategia: leitura busca /tmp primeiro, depois bundle; escrita vai para /tmp.

const BUNDLE_DATA_DIR = path.join(process.cwd(), "data");
const RUNTIME_DATA_DIR = "/tmp/crm-data";

export function bundlePath(filename: string) {
  return path.join(BUNDLE_DATA_DIR, filename);
}

export function runtimePath(filename: string) {
  return path.join(RUNTIME_DATA_DIR, filename);
}

export async function ensureRuntimeDir() {
  await fs.mkdir(RUNTIME_DATA_DIR, { recursive: true });
}

export async function readDataFile<T>(filename: string, fallback: T): Promise<T> {
  // Tenta /tmp primeiro (dados salvos em runtime)
  try {
    const raw = await fs.readFile(runtimePath(filename), "utf8");
    return JSON.parse(raw) as T;
  } catch {}

  // Fallback: arquivo bundlado no deploy (somente leitura)
  try {
    const raw = await fs.readFile(bundlePath(filename), "utf8");
    return JSON.parse(raw) as T;
  } catch {}

  return fallback;
}

export async function writeDataFile<T>(filename: string, value: T): Promise<void> {
  await ensureRuntimeDir();
  await fs.writeFile(runtimePath(filename), JSON.stringify(value, null, 2), "utf8");
}

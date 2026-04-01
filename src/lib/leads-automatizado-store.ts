import { Lead } from "@/types/crm";
import { readDataFile, writeDataFile } from "./storage-paths";

const PENDING_FILE = "leads-automatizado-pendentes.json";

export type PendingAutomatedLeadEntry = {
  requestId: string;
  tipoAutomacao: "api" | "cnpj";
  leads: Lead[];
  savedAt: string;
};

export async function getPendingAutomatedLeads(): Promise<PendingAutomatedLeadEntry[]> {
  return readDataFile<PendingAutomatedLeadEntry[]>(PENDING_FILE, []);
}

export async function savePendingAutomatedLeads(entry: PendingAutomatedLeadEntry): Promise<void> {
  const current = await getPendingAutomatedLeads();
  await writeDataFile(PENDING_FILE, [...current, entry]);
}

export async function consumePendingAutomatedLeads(): Promise<PendingAutomatedLeadEntry[]> {
  const current = await getPendingAutomatedLeads();
  // Sempre zera mesmo se vazio para garantir que /tmp e Supabase ficam sincronizados
  await writeDataFile(PENDING_FILE, []);
  console.log(`[LEADS_AUTO] consume: retornando ${current.length} entradas, arquivo zerado`);
  return current;
}

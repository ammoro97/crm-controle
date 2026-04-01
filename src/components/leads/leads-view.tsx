"use client";

import { ChangeEvent, DragEvent, FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageTopbar } from "@/components/layout/page-topbar";
import { Modal } from "@/components/ui/modal";
import { getLeadsSnapshot, setLeadsSnapshot } from "@/lib/crm-data-store";
import { getLeadContacts, getLeadEmails, getLeadNames, getLeadPhones } from "@/lib/lead-contact-utils";
import { useResponsaveis } from "@/lib/responsaveis-store";
import { CallLog, Lead, LeadChannel, LeadHistoryEvent, LeadObservation, LeadStatus } from "@/types/crm";
import { LeadDetailDrawer } from "./lead-detail-drawer";
import { LeadsTable } from "./leads-table";
import { OutboundLeadsTable } from "./outbound-leads-table";

type LeadFilter = "all" | LeadChannel;
type ImportDestination = "" | LeadChannel;

type LeadsViewProps = {
  title: string;
  filter: LeadFilter;
};

type ImportedLeadRow = {
  name: string;
  company: string;
  phone: string;
  email: string;
  source: string;
  owner: string;
  city: string;
  niche: string;
  status: LeadStatus;
};

type ImportedPreviewRow = ImportedLeadRow & {
  statusType: "valida" | "invalida" | "duplicada";
  statusLabel: string;
};

type LeadAiObservationItem = {
  id?: string;
  leadId?: string;
  callId?: string;
  requestId?: string;
  owner?: string;
  type?: "analise ia";
  content?: string;
  date?: string;
  time?: string;
};

type LeadAiObservationResponse = {
  success?: boolean;
  observations?: LeadAiObservationItem[];
};

type InternalCallsApiResponse = {
  success?: boolean;
  calls?: CallLog[];
};

const statusOptions: LeadStatus[] = [
  "Novo",
  "Contato iniciado",
  "Qualificado",
  "Reuniao marcada",
  "Proposta enviada",
  "Perdido",
  "Fechado",
];

const ESTADOS_BR = [
  { value: "AC", label: "Acre" },
  { value: "AL", label: "Alagoas" },
  { value: "AP", label: "Amapa" },
  { value: "AM", label: "Amazonas" },
  { value: "BA", label: "Bahia" },
  { value: "CE", label: "Ceara" },
  { value: "DF", label: "Distrito Federal" },
  { value: "ES", label: "Espirito Santo" },
  { value: "GO", label: "Goias" },
  { value: "MA", label: "Maranhao" },
  { value: "MT", label: "Mato Grosso" },
  { value: "MS", label: "Mato Grosso do Sul" },
  { value: "MG", label: "Minas Gerais" },
  { value: "PA", label: "Para" },
  { value: "PB", label: "Paraiba" },
  { value: "PR", label: "Parana" },
  { value: "PE", label: "Pernambuco" },
  { value: "PI", label: "Piaui" },
  { value: "RJ", label: "Rio de Janeiro" },
  { value: "RN", label: "Rio Grande do Norte" },
  { value: "RS", label: "Rio Grande do Sul" },
  { value: "RO", label: "Rondonia" },
  { value: "RR", label: "Roraima" },
  { value: "SC", label: "Santa Catarina" },
  { value: "SP", label: "Sao Paulo" },
  { value: "SE", label: "Sergipe" },
  { value: "TO", label: "Tocantins" },
] as const;

type AutomationTipo = "api" | "cnpj";
type AutomationStep = "tipo" | "formulario" | "aguardando" | "sucesso";

type FormApi = {
  totalLeads: string;
  nicho: string;
  estado: string;
  cidade: string;
};

type FormCnpj = {
  cnae: string;
  cidade: string;
  estado: string;
  anos: string;
  quantidade: string;
};

type AutomationApiResponse = {
  success?: boolean;
  leads?: Lead[];
  count?: number;
  pending?: boolean;
  message?: string;
};

function normalizeLead(lead: Lead): Lead {
  const names = getLeadNames(lead);
  const contacts = getLeadContacts(lead);
  const phones = getLeadPhones(lead);
  const emails = getLeadEmails(lead);
  return {
    ...lead,
    name: names[0] || "",
    names,
    contacts,
    phone: phones[0] || "",
    phones,
    email: emails[0] || "",
    emails,
    firstContactDate: lead.firstContactDate ?? "",
    observationLog: lead.observationLog ?? [],
    internalNotes: lead.internalNotes ?? [],
  };
}

function normalizeQueryText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeLeadStatus(value: string): LeadStatus {
  const normalized = normalizeQueryText(value);
  if (normalized === "novo") return "Novo";
  if (normalized === "contato iniciado") return "Contato iniciado";
  if (normalized === "qualificado") return "Qualificado";
  if (normalized === "reuniao marcada") return "Reuniao marcada";
  if (normalized === "proposta enviada") return "Proposta enviada";
  if (normalized === "perdido") return "Perdido";
  if (normalized === "fechado") return "Fechado";
  return "Novo";
}

function nowStamp() {
  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    time: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    datetime: `${now.toISOString().slice(0, 10)} ${now.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    })}`,
  };
}

function historyEvent(owner: string, eventType: string, description: string): LeadHistoryEvent {
  const stamp = nowStamp();
  return {
    id: `H-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: stamp.date,
    time: stamp.time,
    eventType,
    description,
    owner,
  };
}

function toLeadObservationFromAi(item: LeadAiObservationItem): LeadObservation | null {
  const id = String(item?.id || "").trim();
  const content = String(item?.content || "").trim();
  if (!id || !content) return null;
  return {
    id,
    date: String(item?.date || "").trim() || new Date().toISOString().slice(0, 10),
    time: String(item?.time || "").trim() || "00:00",
    owner: String(item?.owner || "Analise da IA").trim() || "Analise da IA",
    type: "analise ia",
    content,
  };
}

function toLeadObservationFromCallLog(call: CallLog): LeadObservation | null {
  const leadId = String(call.leadId || "").trim();
  const content = String(call.aiAnalysis || "").trim();
  if (!leadId || !content) return null;
  const id = String(call.analysisObservationId || "").trim() || `OBS-IA-CALL-${call.id}`;
  const created = String(call.updatedAt || call.endedAt || call.startedAt || call.createdAt || "").trim();
  const parsed = created ? new Date(created) : null;
  const safeDate =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const safeTime =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "00:00";
  return {
    id,
    date: safeDate,
    time: safeTime,
    owner: "Analise da IA",
    type: "analise ia",
    content,
  };
}

function buildLeadCreatedDescription(channel: LeadChannel, source: string) {
  const origem = source?.trim() || (channel === "inbound" ? "Formulario" : "Cadastro manual");
  return `Lead criado. Origem de entrada: ${origem}. Canal: ${channel}.`;
}

function createEmptyLead(filter: LeadFilter): Lead {
  return {
    id: `L-${Date.now()}`,
    name: "",
    names: [],
    company: "",
    phone: "",
    phones: [],
    email: "",
    emails: [],
    status: "Novo",
    source: "",
    owner: "",
    notes: "",
    channel: filter === "all" ? "inbound" : filter,
    city: "",
    niche: "",
    entryDate: new Date().toISOString().slice(0, 10),
    firstContactDate: "",
    lastInteraction: "",
    nextAction: "",
    nextActionDate: "",
    lossReason: "",
    temperature: "frio",
    history: [],
    internalNotes: [],
    observationLog: [],
    inboundQualification:
      filter === "outbound"
        ? undefined
        : {
            campaign: "",
            mainInterest: "organizar agenda",
            initialMessage: "",
            businessType: "estetica",
            specialty: "",
            monthlyRevenueRange: "Ate R$ 50k/mensal",
            averageLeadsPerMonth: "",
            painPoints: [],
            mainProblem: "",
            decisionMakerIdentified: "nao",
            buyingMoment: "curioso",
            icpFit: "medio",
          },
    outboundQualification:
      filter === "inbound"
        ? undefined
        : {
            decisionContacts: [{ name: "", phone: "", email: "" }],
            whoAnswered: "",
            attemptCount: "1",
            businessType: "estetica",
            specialty: "",
            monthlyRevenueRange: "Ate R$ 50k/mensal",
            averageLeadsPerMonth: "",
            employeeCountRange: "1-5",
            unitCount: "1",
            painPoints: [],
            mainProblem: "",
            usesCrm: "nao",
            crmName: "",
            usesDigitalSchedule: "nao",
            usesSpreadsheet: "nao",
            usesNothing: "sim",
            decisionMakerIdentified: "nao",
            buyingMoment: "pesquisando",
            icpFit: "medio",
            teamSize: "",
          },
  };
}

function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : "";
}

function parseRowsMatrix(matrix: string[][]): ImportedLeadRow[] {
  if (matrix.length === 0) return [];

  const firstLine = matrix[0].map((value) => normalizeQueryText(value));
  const hasHeader =
    firstLine.includes("nome") ||
    firstLine.includes("empresa") ||
    firstLine.includes("telefone") ||
    firstLine.includes("email");
  const dataRows = hasHeader ? matrix.slice(1) : matrix;

  return dataRows
    .map((cols) => ({
      name: cols[0] || "",
      company: cols[1] || "",
      phone: cols[2] || "",
      email: cols[3] || "",
      source: cols[4] || "",
      owner: cols[5] || "",
      city: cols[6] || "",
      niche: cols[7] || "",
      status: normalizeLeadStatus(cols[8] || "Novo"),
    }))
    .filter((row) => row.name || row.company || row.phone || row.email);
}

async function parseLeadFile(file: File): Promise<ImportedLeadRow[]> {
  const extension = getFileExtension(file.name);

  if (extension === ".csv") {
    const text = await file.text();
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/[;,|\t]/).map((value) => value.trim()));
    return parseRowsMatrix(rows);
  }

  if (extension === ".xlsx" || extension === ".xls") {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const firstSheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(firstSheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    const rows = rawRows.map((row) => row.map((cell) => `${cell ?? ""}`.trim()));
    return parseRowsMatrix(rows);
  }

  throw new Error("UNSUPPORTED_FILE_TYPE");
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function buildRowIdentity(row: Pick<ImportedLeadRow, "email" | "phone">): string {
  const email = normalizeEmail(row.email);
  if (email) return `email:${email}`;
  const phone = normalizePhone(row.phone);
  if (phone) return `phone:${phone}`;
  return "";
}

export function LeadsView({ title, filter }: LeadsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const responsaveis = useResponsaveis();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openedFromQueryRef = useRef<string | null>(null);

  const [leads, setLeads] = useState<Lead[]>(() => getLeadsSnapshot().map(normalizeLead));
  const [draftLead, setDraftLead] = useState<Lead | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInitialTab, setDetailInitialTab] = useState<"resumo" | "historico" | "qualificacao" | "observacoes">(
    "resumo",
  );
  const [detailInitialObservationId, setDetailInitialObservationId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const [importOpen, setImportOpen] = useState(false);
  const [importDestination, setImportDestination] = useState<ImportDestination>("");
  const [importError, setImportError] = useState("");

  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const [automationOpen, setAutomationOpen] = useState(false);
  const [automationStep, setAutomationStep] = useState<AutomationStep>("tipo");
  const [automationTipo, setAutomationTipo] = useState<AutomationTipo | null>(null);
  const [formApi, setFormApi] = useState<FormApi>({ totalLeads: "", nicho: "", estado: "", cidade: "" });
  const [formCnpj, setFormCnpj] = useState<FormCnpj>({ cnae: "", cidade: "", estado: "", anos: "", quantidade: "" });
  const [isSubmittingAutomation, setIsSubmittingAutomation] = useState(false);
  const [automationError, setAutomationError] = useState("");
  const [automationLeadsCount, setAutomationLeadsCount] = useState(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isParsingImportFile, setIsParsingImportFile] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<ImportedLeadRow[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    const syncLeadLastContact = async () => {
      try {
        const response = await fetch("/api/leads/last-contact", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          success?: boolean;
          overrides?: Record<string, string>;
        };
        if (!response.ok || !data.success || !data.overrides) return;

        setLeads((prev) =>
          prev.map((lead) => {
            const override = data.overrides?.[lead.id];
            if (!override) return lead;
            return {
              ...lead,
              lastInteraction: override,
            };
          }),
        );
      } catch {
        // Ignore sync failures for now
      }
    };

    void syncLeadLastContact();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncAiObservations = async () => {
      try {
        const [response, internalCallsResponse] = await Promise.all([
          fetch("/api/integracoes/analise-ia/observacoes", {
            method: "GET",
            cache: "no-store",
          }),
          fetch("/api/ligacoes", {
            method: "GET",
            cache: "no-store",
          }),
        ]);
        const data = (await response.json()) as LeadAiObservationResponse;
        const internalCallsData = (await internalCallsResponse.json()) as InternalCallsApiResponse;
        if (!response.ok || !data.success || !Array.isArray(data.observations)) return;

        const byLeadId = new Map<string, LeadObservation[]>();
        for (const item of data.observations) {
          const leadId = String(item?.leadId || "").trim();
          if (!leadId) continue;
          const observation = toLeadObservationFromAi(item);
          if (!observation) continue;
          const current = byLeadId.get(leadId) || [];
          current.push(observation);
          byLeadId.set(leadId, current);
        }

        if (internalCallsResponse.ok && internalCallsData.success && Array.isArray(internalCallsData.calls)) {
          for (const call of internalCallsData.calls) {
            const leadId = String(call.leadId || "").trim();
            if (!leadId) continue;
            const observation = toLeadObservationFromCallLog(call);
            if (!observation) continue;
            const current = byLeadId.get(leadId) || [];
            current.push(observation);
            byLeadId.set(leadId, current);
          }
        }

        if (cancelled || byLeadId.size === 0) return;

        setLeads((prev) => {
          let changed = false;
          const next = prev.map((lead) => {
            const incoming = byLeadId.get(lead.id);
            if (!incoming || incoming.length === 0) return lead;
            const existingIds = new Set((lead.observationLog || []).map((item) => item.id));
            const toInsert = incoming.filter((item) => !existingIds.has(item.id));
            if (toInsert.length === 0) return lead;
            changed = true;
            return {
              ...lead,
              observationLog: [...(lead.observationLog || []), ...toInsert],
            };
          });
          return changed ? next : prev;
        });
      } catch {
        // ignore background sync failures
      }
    };

    void syncAiObservations();
    const intervalId = window.setInterval(() => {
      void syncAiObservations();
    }, 12000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const visibleLeads = useMemo(() => {
    const base = filter === "all" ? leads : leads.filter((lead) => lead.channel === filter);
    const sorted = [...base].sort((a, b) => a.name.localeCompare(b.name));
    const normalizedSearch = normalizeQueryText(deferredSearchTerm);
    if (!normalizedSearch) return sorted;

    return sorted.filter((lead) => {
      const haystack = [
        normalizeQueryText(lead.name),
        ...getLeadNames(lead).map((name) => normalizeQueryText(name)),
        normalizeQueryText(lead.company),
        normalizeQueryText(lead.phone),
        ...getLeadPhones(lead).map((phone) => normalizeQueryText(phone)),
        normalizeQueryText(lead.email),
        ...getLeadEmails(lead).map((email) => normalizeQueryText(email)),
      ];
      return haystack.some((value) => value.includes(normalizedSearch));
    });
  }, [deferredSearchTerm, filter, leads]);

  const detailLead = useMemo(() => leads.find((lead) => lead.id === detailLeadId) ?? null, [detailLeadId, leads]);

  useEffect(() => {
    const leadId = String(searchParams.get("leadId") || "").trim();
    if (!leadId) return;
    const leadExists = leads.some((lead) => lead.id === leadId);
    if (!leadExists) return;

    const requestedTab = String(searchParams.get("tab") || "").trim().toLowerCase();
    const safeTab =
      requestedTab === "observacoes"
        ? "observacoes"
        : requestedTab === "historico"
          ? "historico"
          : requestedTab === "qualificacao"
            ? "qualificacao"
            : "resumo";
    const observationId =
      String(searchParams.get("highlightObservation") || searchParams.get("observationId") || "").trim() || null;
    const queryKey = `${leadId}|${safeTab}|${observationId || ""}`;
    if (openedFromQueryRef.current === queryKey) return;
    openedFromQueryRef.current = queryKey;

    setDetailInitialTab(safeTab);
    setDetailInitialObservationId(observationId);
    setDetailLeadId(leadId);
    setDetailOpen(true);

    const pathname = typeof window !== "undefined" ? window.location.pathname : "/leads";
    router.replace(pathname, { scroll: false });
  }, [leads, router, searchParams]);

  const importPreviewRows = useMemo<ImportedPreviewRow[]>(() => {
    const existingKeys = new Set(leads.map((lead) => buildRowIdentity(lead)).filter(Boolean));
    const seenKeys = new Set<string>();

    return importRows.map((row) => {
      if (!row.name.trim()) return { ...row, statusType: "invalida", statusLabel: "Invalida: nome obrigatorio" };
      if (!row.phone.trim() && !row.email.trim()) {
        return { ...row, statusType: "invalida", statusLabel: "Invalida: telefone ou email obrigatorio" };
      }

      const key = buildRowIdentity(row);
      if (key && (existingKeys.has(key) || seenKeys.has(key))) {
        return { ...row, statusType: "duplicada", statusLabel: "Duplicada (ignorada)" };
      }
      if (key) seenKeys.add(key);

      return { ...row, statusType: "valida", statusLabel: "Valida" };
    });
  }, [importRows, leads]);

  const importSummary = useMemo(() => {
    const total = importPreviewRows.length;
    const valid = importPreviewRows.filter((row) => row.statusType === "valida").length;
    const invalid = importPreviewRows.filter((row) => row.statusType === "invalida").length;
    const duplicates = importPreviewRows.filter((row) => row.statusType === "duplicada").length;
    return { total, valid, invalid, duplicates };
  }, [importPreviewRows]);

  const openLeadDetails = (lead: Lead) => {
    setDetailInitialTab("resumo");
    setDetailInitialObservationId(null);
    setDetailLeadId(lead.id);
    setDetailOpen(true);
  };

  const updateLeadById = (workingLead: Lead) => {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== workingLead.id) return lead;

        return {
          ...workingLead,
          history: lead.history,
          lastInteraction: lead.lastInteraction,
        };
      }),
    );
  };

  const deleteLeadsById = (ids: string[]) => {
    const toDelete = new Set(ids);
    setLeads((prev) => prev.filter((lead) => !toDelete.has(lead.id)));
  };

  const handleCreateLead = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftLead) return;
    const stamp = nowStamp();
    const leadToInsert: Lead = {
      ...draftLead,
      history: [
        {
          id: `H-${draftLead.id}-1`,
          date: stamp.date,
          time: stamp.time,
          eventType: "LEAD_CRIADO",
          description: buildLeadCreatedDescription(draftLead.channel, draftLead.source),
          owner: draftLead.owner || "Time Comercial",
        },
      ],
      lastInteraction: stamp.datetime,
      internalNotes: draftLead.internalNotes,
      observationLog: draftLead.observationLog,
    };

    setLeads((prev) => [...prev, leadToInsert]);
    setCreateOpen(false);
    setDraftLead(null);
  };

  const resetAutomation = () => {
    setAutomationStep("tipo");
    setAutomationTipo(null);
    setFormApi({ totalLeads: "", nicho: "", estado: "", cidade: "" });
    setFormCnpj({ cnae: "", cidade: "", estado: "", anos: "", quantidade: "" });
    setIsSubmittingAutomation(false);
    setAutomationError("");
    setAutomationLeadsCount(0);
  };

  const closeAutomation = () => {
    setAutomationOpen(false);
    resetAutomation();
  };

  const handleSubmitAutomation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!automationTipo) return;

    setIsSubmittingAutomation(true);
    setAutomationError("");

    try {
      const payload =
        automationTipo === "api"
          ? {
              tipoAutomacao: "api" as const,
              totalLeads: parseInt(formApi.totalLeads, 10),
              nicho: formApi.nicho.trim(),
              pais: "Brasil" as const,
              estado: formApi.estado || undefined,
              cidade: formApi.cidade.trim() || undefined,
            }
          : {
              tipoAutomacao: "cnpj" as const,
              cnae: formCnpj.cnae.trim(),
              cidade: formCnpj.cidade.trim() || undefined,
              estado: formCnpj.estado || undefined,
              anos: formCnpj.anos ? parseInt(formCnpj.anos, 10) : undefined,
              quantidade: parseInt(formCnpj.quantidade, 10),
            };

      const response = await fetch("/api/leads/automatizado/solicitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as AutomationApiResponse;

      if (!response.ok || !data.success) {
        setAutomationError(data.message || "Erro ao processar automacao. Tente novamente.");
        return;
      }

      const returnedLeads = data.leads ?? [];
      if (returnedLeads.length > 0) {
        // n8n respondeu sincronamente com leads
        setLeads((prev) => {
          const existingIds = new Set(prev.map((l) => l.id));
          const existingPhones = new Set(prev.filter((l) => l.phone).map((l) => l.phone));
          const incoming = returnedLeads
            .map(normalizeLead)
            .filter((l) => !existingIds.has(l.id) && (!l.phone || !existingPhones.has(l.phone)));
          return incoming.length > 0 ? [...prev, ...incoming] : prev;
        });
        setAutomationLeadsCount(returnedLeads.length);
        setAutomationStep("sucesso");
      } else if (data.pending) {
        // n8n processa async — aguarda callback via /retorno + polling /pendentes
        setAutomationStep("aguardando");
      } else {
        setAutomationError("Nenhum lead foi retornado pela automacao. Verifique os parametros e tente novamente.");
      }
    } catch {
      setAutomationError("Nao foi possivel conectar ao servico de automacao. Tente novamente.");
    } finally {
      setIsSubmittingAutomation(false);
    }
  };

  const clearImport = () => {
    setImportDestination("");
    setImportError("");
    setImportFileName("");
    setImportRows([]);
    setIsDraggingFile(false);
    setIsParsingImportFile(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const closeImport = () => {
    setImportOpen(false);
    clearImport();
  };

  const loadImportFile = async (file: File) => {
    const extension = getFileExtension(file.name);
    if (![".xlsx", ".xls", ".csv"].includes(extension)) {
      setImportError("Formato de arquivo nao suportado. Envie uma planilha .xlsx, .xls ou .csv.");
      return;
    }

    setImportError("");
    setIsParsingImportFile(true);
    try {
      const rows = await parseLeadFile(file);
      setImportFileName(file.name);
      setImportRows(rows);
      if (rows.length === 0) {
        setImportError("Nenhum registro valido foi encontrado na planilha.");
      }
    } catch {
      setImportError("Nao foi possivel ler o arquivo. Verifique a planilha e tente novamente.");
      setImportFileName("");
      setImportRows([]);
    } finally {
      setIsParsingImportFile(false);
    }
  };

  const onFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadImportFile(file);
  };

  const onDropFile = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFile(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await loadImportFile(file);
  };

  const importLeads = () => {
    if (!importDestination) {
      setImportError("Selecione se os leads serao importados como Inbound ou Outbound.");
      return;
    }

    const validRows = importPreviewRows.filter((row) => row.statusType === "valida");
    if (validRows.length === 0) {
      setImportError("Nao ha leads validos para importar.");
      return;
    }

    const stamp = nowStamp();
    const imported = validRows.map((row, index) => {
      const id = `L-IMP-${Date.now()}-${index + 1}`;
      const owner = row.owner || responsaveis[0] || "";
      const base = createEmptyLead(importDestination);
      return {
        ...base,
        id,
        name: row.name || "Lead importado",
        company: row.company || "-",
        phone: row.phone,
        email: row.email,
        source: row.source || "Importacao",
        owner,
        city: row.city,
        niche: row.niche,
        status: row.status,
        channel: importDestination,
        firstContactDate: "",
        history: [
          {
            id: `H-${id}-1`,
            date: stamp.date,
            time: stamp.time,
            eventType: "LEAD_CRIADO",
            description: buildLeadCreatedDescription(importDestination, row.source || "Importacao de lista"),
            owner: owner || "Time Comercial",
          },
        ],
        lastInteraction: stamp.datetime,
      };
    });

    setLeads((prev) => [...prev, ...imported]);
    closeImport();
  };

  useEffect(() => {
    const saveId = setTimeout(() => {
      setLeadsSnapshot(leads);
    }, 220);

    return () => clearTimeout(saveId);
  }, [leads]);

  useEffect(() => {
    if (automationStep !== "aguardando") return;

    let attempts = 0;
    const MAX_ATTEMPTS = 24; // 2 minutos a cada 5s

    const intervalId = setInterval(async () => {
      attempts++;
      try {
        const response = await fetch("/api/leads/automatizado/pendentes", {
          method: "GET",
          cache: "no-store",
        });
        const data = (await response.json()) as AutomationApiResponse;
        if (response.ok && data.success && data.leads && data.leads.length > 0) {
          setLeads((prev) => {
            const existingIds = new Set(prev.map((l) => l.id));
            const existingPhones = new Set(prev.filter((l) => l.phone).map((l) => l.phone));
            const incoming = data.leads!
              .map(normalizeLead)
              .filter((l) => !existingIds.has(l.id) && (!l.phone || !existingPhones.has(l.phone)));
            return incoming.length > 0 ? [...prev, ...incoming] : prev;
          });
          setAutomationLeadsCount(data.leads.length);
          setAutomationStep("sucesso");
          return;
        }
      } catch {
        // Ignora falhas de poll
      }
      if (attempts >= MAX_ATTEMPTS) {
        setAutomationError(
          "Tempo limite excedido. Verifique se o n8n processou a solicitacao e tente novamente.",
        );
        setAutomationStep("formulario");
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [automationStep]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addMenuOpen]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const poll = async () => {
      while (active) {
        await new Promise<void>((resolve) => setTimeout(resolve, 30000));
        if (!active) break;
        try {
          const response = await fetch("/api/leads/automatizado/pendentes", {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          });
          const data = (await response.json()) as AutomationApiResponse;
          if (response.ok && data.success && data.leads && data.leads.length > 0) {
            setLeads((prev) => {
              const existingIds = new Set(prev.map((l) => l.id));
              const existingPhones = new Set(prev.filter((l) => l.phone).map((l) => l.phone));
              const incoming = data.leads!
                .map(normalizeLead)
                .filter((l) => !existingIds.has(l.id) && (!l.phone || !existingPhones.has(l.phone)));
              return incoming.length > 0 ? [...prev, ...incoming] : prev;
            });
          }
        } catch {
          // Ignore poll failures silently
        }
      }
    };

    void poll();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <section>
      <PageTopbar
        title={title}
        showSearch={false}
        actionsSlot={
          <div ref={addMenuRef} className="relative">
            <button
              type="button"
              className="btn-primary flex h-10 items-center gap-1.5 px-4"
              onClick={() => setAddMenuOpen((prev) => !prev)}
              aria-haspopup="true"
              aria-expanded={addMenuOpen}
            >
              Adicionar Lead
              <svg viewBox="0 0 16 16" fill="currentColor" className={`h-3.5 w-3.5 transition-transform ${addMenuOpen ? "rotate-180" : ""}`}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {addMenuOpen ? (
              <div className="absolute right-0 top-full z-30 mt-1.5 w-44 overflow-hidden rounded-xl border border-border bg-slate-900 shadow-xl">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                  onClick={() => {
                    setAddMenuOpen(false);
                    setDraftLead(createEmptyLead(filter));
                    setCreateOpen(true);
                  }}
                >
                  <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 text-slate-400" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                  </svg>
                  Manual
                </button>
                <div className="mx-3 h-px bg-border" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                  onClick={() => {
                    setAddMenuOpen(false);
                    setAutomationOpen(true);
                  }}
                >
                  <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 text-slate-400" stroke="currentColor" strokeWidth="1.5">
                    <path d="M9 3L5 8h4l-2 5 6-7H9l2-3z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Automatizado
                </button>
              </div>
            ) : null}
          </div>
        }
      />

      <section className="panel mb-3 p-3 xl:p-3.5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <label className="w-full text-[11px] font-medium uppercase tracking-[0.08em] text-muted md:max-w-xl">
            Busca global de leads
            <input
              className="field mt-1.5 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
              placeholder="Buscar por nome, empresa, telefone ou email"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <button type="button" className="btn-ghost h-9 px-3 py-1.5 text-xs" onClick={() => setImportOpen(true)}>
            Importar Leads
          </button>
        </div>
      </section>

      {filter === "outbound" ? (
        <OutboundLeadsTable leads={visibleLeads} onSelectLead={openLeadDetails} onDeleteLeads={deleteLeadsById} />
      ) : (
        <LeadsTable leads={visibleLeads} onSelectLead={openLeadDetails} onSaveRow={updateLeadById} onDeleteLeads={deleteLeadsById} />
      )}

      <Modal
        title={
          automationStep === "tipo"
            ? "Automacao de Leads"
            : automationStep === "aguardando"
              ? "Processando..."
              : automationStep === "sucesso"
                ? "Leads Importados"
                : automationTipo === "api"
                  ? "Automacao por API"
                  : "Automacao por CNPJ"
        }
        open={automationOpen}
        onClose={closeAutomation}
      >
        {automationStep === "aguardando" ? (
          <div className="space-y-5 py-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/10">
              <svg
                className="h-7 w-7 animate-spin text-sky-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-slate-100">Buscando leads...</p>
              <p className="mt-1 text-sm text-slate-400">
                O n8n esta processando a solicitacao. Isso pode levar alguns instantes.
              </p>
            </div>
            <button type="button" className="btn-ghost h-9 px-4 text-sm" onClick={closeAutomation}>
              Fechar — os leads serao adicionados automaticamente ao chegar
            </button>
          </div>
        ) : automationStep === "tipo" ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">Escolha como a automacao deve buscar os leads outbound.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="group rounded-xl border border-border bg-slate-900/60 p-4 text-left transition hover:border-slate-500 hover:bg-slate-800/80"
                onClick={() => {
                  setAutomationTipo("api");
                  setAutomationStep("formulario");
                  setAutomationError("");
                }}
              >
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                    <path d="M3 7l4-4 4 4M7 3v10M13 7l4 4-4 4M17 11V7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="font-semibold text-slate-100">Por API</p>
                <p className="mt-1 text-xs text-slate-400">Busca por nicho, localidade e volume de leads.</p>
              </button>
              <button
                type="button"
                className="group rounded-xl border border-border bg-slate-900/60 p-4 text-left transition hover:border-slate-500 hover:bg-slate-800/80"
                onClick={() => {
                  setAutomationTipo("cnpj");
                  setAutomationStep("formulario");
                  setAutomationError("");
                }}
              >
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                    <path d="M4 4h12v12H4V4z" strokeLinecap="round" />
                    <path d="M8 8h4M8 11h2" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="font-semibold text-slate-100">Por CNPJ</p>
                <p className="mt-1 text-xs text-slate-400">Busca por CNAE, cidade, estado e tempo de abertura.</p>
              </button>
            </div>
            <button type="button" className="btn-ghost h-9 px-3 text-sm" onClick={closeAutomation}>
              Cancelar
            </button>
          </div>
        ) : automationStep === "sucesso" ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7 text-emerald-400">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-100">
                {automationLeadsCount} {automationLeadsCount === 1 ? "lead importado" : "leads importados"}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Os leads foram cadastrados como outbound e ja aparecem na listagem.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <button type="button" className="btn-ghost h-9 px-4 text-sm" onClick={closeAutomation}>
                Fechar
              </button>
              <button
                type="button"
                className="btn-primary h-9 px-4 text-sm"
                onClick={() => {
                  resetAutomation();
                }}
              >
                Nova automacao
              </button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmitAutomation}>
            {automationTipo === "api" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  Total de leads <span className="text-rose-400">*</span>
                  <input
                    className="field mt-1"
                    type="number"
                    min={1}
                    placeholder="Ex: 100"
                    value={formApi.totalLeads}
                    onChange={(e) => setFormApi({ ...formApi, totalLeads: e.target.value })}
                    required
                  />
                </label>
                <label className="text-sm">
                  Nicho <span className="text-rose-400">*</span>
                  <input
                    className="field mt-1"
                    placeholder="Ex: Clinica de estetica"
                    value={formApi.nicho}
                    onChange={(e) => setFormApi({ ...formApi, nicho: e.target.value })}
                    required
                  />
                </label>
                <label className="text-sm">
                  Pais
                  <input className="field mt-1 cursor-not-allowed opacity-60" value="Brasil" readOnly />
                </label>
                <label className="text-sm">
                  Estado
                  <select
                    className="field mt-1"
                    value={formApi.estado}
                    onChange={(e) => setFormApi({ ...formApi, estado: e.target.value })}
                  >
                    <option value="">Todos os estados</option>
                    {ESTADOS_BR.map((uf) => (
                      <option key={uf.value} value={uf.value}>
                        {uf.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm md:col-span-2">
                  Cidade
                  <input
                    className="field mt-1"
                    placeholder="Ex: Sao Paulo (opcional)"
                    value={formApi.cidade}
                    onChange={(e) => setFormApi({ ...formApi, cidade: e.target.value })}
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  CNAE <span className="text-rose-400">*</span>
                  <input
                    className="field mt-1"
                    placeholder="Ex: 8630-5/04"
                    value={formCnpj.cnae}
                    onChange={(e) => setFormCnpj({ ...formCnpj, cnae: e.target.value })}
                    required
                  />
                </label>
                <label className="text-sm">
                  Quantidade <span className="text-rose-400">*</span>
                  <input
                    className="field mt-1"
                    type="number"
                    min={1}
                    placeholder="Ex: 200"
                    value={formCnpj.quantidade}
                    onChange={(e) => setFormCnpj({ ...formCnpj, quantidade: e.target.value })}
                    required
                  />
                </label>
                <label className="text-sm">
                  Estado
                  <select
                    className="field mt-1"
                    value={formCnpj.estado}
                    onChange={(e) => setFormCnpj({ ...formCnpj, estado: e.target.value })}
                  >
                    <option value="">Todos os estados</option>
                    {ESTADOS_BR.map((uf) => (
                      <option key={uf.value} value={uf.value}>
                        {uf.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Cidade
                  <input
                    className="field mt-1"
                    placeholder="Ex: Curitiba (opcional)"
                    value={formCnpj.cidade}
                    onChange={(e) => setFormCnpj({ ...formCnpj, cidade: e.target.value })}
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  Anos de abertura minimos
                  <input
                    className="field mt-1"
                    type="number"
                    min={0}
                    placeholder="Ex: 5 (opcional — busca empresas com pelo menos X anos)"
                    value={formCnpj.anos}
                    onChange={(e) => setFormCnpj({ ...formCnpj, anos: e.target.value })}
                  />
                </label>
              </div>
            )}

            {automationError ? (
              <p className="rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {automationError}
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost h-9 px-3 text-sm"
                onClick={() => {
                  setAutomationStep("tipo");
                  setAutomationError("");
                }}
                disabled={isSubmittingAutomation}
              >
                Voltar
              </button>
              <button type="submit" className="btn-primary h-9 px-4 text-sm" disabled={isSubmittingAutomation}>
                {isSubmittingAutomation ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal title="Novo Lead" open={createOpen} onClose={() => {
        setCreateOpen(false);
        setDraftLead(null);
      }}>
        {draftLead ? (
          <form className="space-y-4" onSubmit={handleCreateLead}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">Nome<input className="field mt-1" value={draftLead.name} onChange={(e) => setDraftLead({ ...draftLead, name: e.target.value })} required /></label>
              <label className="text-sm">Empresa/Clinica<input className="field mt-1" value={draftLead.company} onChange={(e) => setDraftLead({ ...draftLead, company: e.target.value })} required /></label>
              <label className="text-sm">Telefone<input className="field mt-1" value={draftLead.phone} onChange={(e) => setDraftLead({ ...draftLead, phone: e.target.value })} /></label>
              <label className="text-sm">Email<input className="field mt-1" type="email" value={draftLead.email} onChange={(e) => setDraftLead({ ...draftLead, email: e.target.value })} /></label>
              <label className="text-sm">Cidade<input className="field mt-1" value={draftLead.city} onChange={(e) => setDraftLead({ ...draftLead, city: e.target.value })} /></label>
              <label className="text-sm">Nicho<input className="field mt-1" value={draftLead.niche} onChange={(e) => setDraftLead({ ...draftLead, niche: e.target.value })} /></label>
              <label className="text-sm">Origem<input className="field mt-1" value={draftLead.source} onChange={(e) => setDraftLead({ ...draftLead, source: e.target.value })} /></label>
              <label className="text-sm">Responsavel<select className="field mt-1" value={draftLead.owner} onChange={(e) => setDraftLead({ ...draftLead, owner: e.target.value })}><option value="">Selecione...</option>{responsaveis.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
              <label className="text-sm">Canal<select className="field mt-1" value={draftLead.channel} onChange={(e) => setDraftLead({ ...draftLead, channel: e.target.value as LeadChannel })}><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></label>
              <label className="text-sm">Status<select className="field mt-1" value={draftLead.status} onChange={(e) => setDraftLead({ ...draftLead, status: e.target.value as LeadStatus })}>{statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            </div>
            <button type="submit" className="btn-primary">Criar lead</button>
          </form>
        ) : null}
      </Modal>

      <LeadDetailDrawer
        key={detailLead?.id ?? "drawer"}
        lead={detailLead}
        open={detailOpen}
        onSave={updateLeadById}
        initialTab={detailInitialTab}
        initialObservationId={detailInitialObservationId}
        onClose={() => {
          setDetailOpen(false);
          setDetailLeadId(null);
          setDetailInitialTab("resumo");
          setDetailInitialObservationId(null);
        }}
      />

      <Modal title="Importar Leads" open={importOpen} onClose={closeImport}>
        <div className="space-y-4">
          <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Destino dos leads
            <select
              className="field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
              value={importDestination}
              onChange={(event) => {
                setImportDestination(event.target.value as ImportDestination);
                setImportError("");
              }}
            >
              <option value="">Selecione...</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
          </label>

          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileInputChange} />

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setIsDraggingFile(false);
            }}
            onDrop={onDropFile}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition ${
              isDraggingFile
                ? "border-emerald-400 bg-emerald-500/10"
                : "border-slate-600 bg-slate-900/40 hover:border-slate-500 hover:bg-slate-900/60"
            }`}
          >
            <p className="text-sm font-semibold text-slate-100">Arraste sua planilha aqui</p>
            <p className="mt-1 text-xs text-slate-400">ou clique para selecionar um arquivo</p>
            <p className="mt-2 text-[11px] text-slate-500">Formatos aceitos: .xlsx, .xls, .csv</p>
          </div>

          {isParsingImportFile ? <p className="text-xs text-slate-300">Lendo arquivo...</p> : null}

          {importFileName ? (
            <div className="rounded-lg border border-border bg-slate-900/40 p-3 text-xs text-slate-300">
              <p>Arquivo: <span className="font-semibold text-slate-100">{importFileName}</span></p>
              <p className="mt-1">Registros lidos: {importRows.length}</p>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" className="rounded-md border border-border px-2 py-1 text-[11px] text-slate-200 transition hover:bg-slate-800" onClick={() => fileInputRef.current?.click()}>Trocar arquivo</button>
                <button type="button" className="rounded-md border border-rose-400/40 px-2 py-1 text-[11px] text-rose-200 transition hover:bg-rose-500/10" onClick={clearImport}>Remover</button>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-slate-900/40 p-3 text-xs text-slate-300">
            <p>Destino selecionado: <span className="font-semibold text-slate-100">{importDestination ? (importDestination === "inbound" ? "Inbound" : "Outbound") : "-"}</span></p>
            <p className="mt-1">Total lido: {importSummary.total}</p>
            <p>Validos: {importSummary.valid}</p>
            <p>Invalidos: {importSummary.invalid}</p>
            <p>Duplicados ignorados: {importSummary.duplicates}</p>
          </div>

          {importPreviewRows.length > 0 ? (
            <div className="max-h-56 overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/70 text-slate-300"><tr><th className="px-2 py-2">Nome</th><th className="px-2 py-2">Telefone</th><th className="px-2 py-2">Empresa</th><th className="px-2 py-2">Email</th><th className="px-2 py-2">Status</th></tr></thead>
                <tbody>
                  {importPreviewRows.map((row, index) => (
                    <tr key={`${row.email}-${row.phone}-${index}`} className="border-t border-border/80">
                      <td className="px-2 py-1.5 text-slate-100">{row.name || "-"}</td>
                      <td className="px-2 py-1.5 text-slate-300">{row.phone || "-"}</td>
                      <td className="px-2 py-1.5 text-slate-300">{row.company || "-"}</td>
                      <td className="px-2 py-1.5 text-slate-300">{row.email || "-"}</td>
                      <td className="px-2 py-1.5"><span className={`rounded px-2 py-0.5 ${row.statusType === "valida" ? "bg-emerald-500/20 text-emerald-300" : row.statusType === "duplicada" ? "bg-amber-500/20 text-amber-300" : "bg-rose-500/20 text-rose-300"}`}>{row.statusLabel}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {importError ? <p className="rounded-md border border-rose-400/40 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200">{importError}</p> : null}

          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost h-9 px-3 py-1.5 text-xs" onClick={closeImport}>Cancelar</button>
            <button type="button" className="btn-primary h-9 px-3 py-1.5 text-xs" onClick={importLeads} disabled={isParsingImportFile}>Importar leads</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

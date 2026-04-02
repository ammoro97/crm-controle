"use client";

import { ChangeEvent, DragEvent, FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { PageTopbar } from "@/components/layout/page-topbar";
import { Modal } from "@/components/ui/modal";
import {
  getCustomersSnapshot,
  getLeadFinalizationsSnapshot,
  getLeadsSnapshot,
  getMeetingsSnapshot,
  setCustomersSnapshot,
  setLeadFinalizationsSnapshot,
  setLeadsSnapshot,
  subscribeLeadFinalizationsSnapshot,
  subscribeMeetingsSnapshot,
} from "@/lib/crm-data-store";
import { getLeadContacts, getLeadEmails, getLeadNames, getLeadPhones } from "@/lib/lead-contact-utils";
import { useResponsaveis } from "@/lib/responsaveis-store";
import { getPostCallWrapups, subscribePostCallFlow, type PostCallWrapup } from "@/lib/post-call-flow";
import { formatSaleValueCents, isValidSaleValueCents } from "@/lib/sale-value";
import { buildOutboundDashboardMetrics } from "@/lib/leads-outbound-dashboard";
import GridLayout, { WidthProvider, type Layout as ReactGridLayoutItem } from "react-grid-layout";
import {
  CallLog,
  Lead,
  LeadChannel,
  LeadFinalizationReason,
  LeadFinalizationRecord,
  LeadHistoryEvent,
  LeadObservation,
  LeadStatus,
  Meeting,
} from "@/types/crm";
import { LeadDetailDrawer } from "./lead-detail-drawer";
import { LeadsTable } from "./leads-table";
import { OutboundLeadsTable } from "./outbound-leads-table";

const DashboardGridLayout = WidthProvider(GridLayout);

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

type DashboardWidgetId =
  | "taxa_conversao"
  | "cobertura_base"
  | "leads_finalizados"
  | "compras_efetuadas"
  | "valor_total_feito"
  | "leads_prospectados"
  | "calls_agendadas"
  | "ligacoes_feitas"
  | "emails_enviados"
  | "funil_vendas"
  | "atividades_bdr"
  | "followups_pendentes"
  | "taxa_conversao_indicador";

type DashboardWidgetLayoutItem = {
  id: DashboardWidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
};

type PersistedDashboardLayout = {
  order: DashboardWidgetId[];
  items: DashboardWidgetLayoutItem[];
};

const DASHBOARD_LAYOUT_STORAGE_KEY = "crm.leads.dashboard.layout.v1";
const DASHBOARD_GUEST_USER_KEY = "guest";

const defaultDashboardWidgetOrder: DashboardWidgetId[] = [
  "taxa_conversao",
  "cobertura_base",
  "leads_finalizados",
  "compras_efetuadas",
  "valor_total_feito",
  "leads_prospectados",
  "calls_agendadas",
  "ligacoes_feitas",
  "emails_enviados",
  "funil_vendas",
  "atividades_bdr",
  "followups_pendentes",
  "taxa_conversao_indicador",
];

const DASHBOARD_LAYOUT_COLUMNS_MAX = 12;
const DASHBOARD_LAYOUT_ROW_HEIGHT = 62;
const DASHBOARD_LAYOUT_GAP = 12;

const dashboardWidgetDimensions: Record<DashboardWidgetId, { w: number; h: number }> = {
  taxa_conversao: { w: 3, h: 2 },
  cobertura_base: { w: 3, h: 2 },
  leads_finalizados: { w: 3, h: 2 },
  compras_efetuadas: { w: 3, h: 2 },
  valor_total_feito: { w: 3, h: 2 },
  leads_prospectados: { w: 3, h: 2 },
  calls_agendadas: { w: 3, h: 2 },
  ligacoes_feitas: { w: 3, h: 2 },
  emails_enviados: { w: 3, h: 2 },
  funil_vendas: { w: 8, h: 4 },
  atividades_bdr: { w: 4, h: 4 },
  followups_pendentes: { w: 6, h: 2 },
  taxa_conversao_indicador: { w: 6, h: 2 },
};

const dashboardWidgetConstraints: Record<DashboardWidgetId, { minW: number; minH: number; maxW?: number; maxH?: number }> = {
  taxa_conversao: { minW: 2, minH: 1 },
  cobertura_base: { minW: 2, minH: 1 },
  leads_finalizados: { minW: 2, minH: 1 },
  compras_efetuadas: { minW: 2, minH: 1 },
  valor_total_feito: { minW: 2, minH: 1 },
  leads_prospectados: { minW: 2, minH: 1 },
  calls_agendadas: { minW: 2, minH: 1 },
  ligacoes_feitas: { minW: 2, minH: 1 },
  emails_enviados: { minW: 2, minH: 1 },
  funil_vendas: { minW: 4, minH: 2 },
  atividades_bdr: { minW: 3, minH: 2 },
  followups_pendentes: { minW: 3, minH: 1 },
  taxa_conversao_indicador: { minW: 3, minH: 1 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveDashboardGridColumns(viewportWidth: number): number {
  if (viewportWidth >= 1536) return 12;
  if (viewportWidth >= 1280) return 10;
  if (viewportWidth >= 1024) return 8;
  if (viewportWidth >= 768) return 6;
  if (viewportWidth >= 560) return 4;
  if (viewportWidth >= 420) return 3;
  return 2;
}

function normalizeDashboardWidgetOrder(orderValue: unknown): DashboardWidgetId[] {
  const source = Array.isArray(orderValue) ? orderValue : [];
  const allowed = new Set<DashboardWidgetId>(defaultDashboardWidgetOrder);
  const unique = new Set<DashboardWidgetId>();
  const ordered: DashboardWidgetId[] = [];

  for (const candidate of source) {
    const key = String(candidate || "") as DashboardWidgetId;
    if (!allowed.has(key) || unique.has(key)) continue;
    unique.add(key);
    ordered.push(key);
  }

  for (const fallback of defaultDashboardWidgetOrder) {
    if (unique.has(fallback)) continue;
    ordered.push(fallback);
  }

  return ordered;
}

function getWidgetBounds(widgetId: DashboardWidgetId, columns: number) {
  const normalizedColumns = Math.max(1, columns);
  const defaults = dashboardWidgetDimensions[widgetId];
  const constraints = dashboardWidgetConstraints[widgetId];
  const minW = Math.min(normalizedColumns, Math.max(1, constraints.minW));
  const maxW = Math.min(normalizedColumns, Math.max(minW, constraints.maxW ?? normalizedColumns));
  const minH = Math.max(1, constraints.minH);
  const maxH = Math.max(minH, constraints.maxH ?? 12);
  const defaultW = clamp(defaults.w, minW, maxW);
  const defaultH = clamp(defaults.h, minH, maxH);
  return { minW, maxW, minH, maxH, defaultW, defaultH };
}

function toLayoutRecord(items: DashboardWidgetLayoutItem[]): Record<DashboardWidgetId, DashboardWidgetLayoutItem> {
  const record = {} as Record<DashboardWidgetId, DashboardWidgetLayoutItem>;
  for (const item of items) {
    record[item.id] = item;
  }
  return record;
}

function compactDashboardLayoutItems(items: DashboardWidgetLayoutItem[], columns: number): DashboardWidgetLayoutItem[] {
  const normalizedColumns = Math.max(1, columns);
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const occupied = new Set<string>();
  const compacted: DashboardWidgetLayoutItem[] = [];

  const canPlace = (x: number, y: number, w: number, h: number) => {
    if (x + w > normalizedColumns) return false;
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        if (occupied.has(`${col}:${row}`)) return false;
      }
    }
    return true;
  };

  const markPlaced = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        occupied.add(`${col}:${row}`);
      }
    }
  };

  for (const item of sorted) {
    const bounds = getWidgetBounds(item.id, normalizedColumns);
    const w = clamp(item.w, bounds.minW, bounds.maxW);
    const h = clamp(item.h, bounds.minH, bounds.maxH);
    const x = clamp(item.x, 0, Math.max(0, normalizedColumns - w));

    let y = 0;
    while (!canPlace(x, y, w, h) && y < 400) {
      y += 1;
    }

    markPlaced(x, y, w, h);
    compacted.push({ id: item.id, x, y, w, h });
  }

  return compacted;
}

function scaleDashboardLayoutItems(
  items: DashboardWidgetLayoutItem[],
  fromColumns: number,
  toColumns: number,
): DashboardWidgetLayoutItem[] {
  const safeFrom = Math.max(1, fromColumns);
  const safeTo = Math.max(1, toColumns);
  if (safeFrom === safeTo) return compactDashboardLayoutItems(items, safeTo);

  const scaled = items.map((item) => {
    const bounds = getWidgetBounds(item.id, safeTo);
    const scaledW = clamp(Math.round((item.w / safeFrom) * safeTo), bounds.minW, bounds.maxW);
    const scaledX = clamp(Math.round((item.x / safeFrom) * safeTo), 0, Math.max(0, safeTo - scaledW));
    const scaledH = clamp(item.h, bounds.minH, bounds.maxH);
    return {
      ...item,
      x: scaledX,
      w: scaledW,
      h: scaledH,
    };
  });

  return compactDashboardLayoutItems(scaled, safeTo);
}

function buildDashboardLayoutItems(
  order: DashboardWidgetId[],
  columns = DASHBOARD_LAYOUT_COLUMNS_MAX,
  preferredById: Partial<Record<DashboardWidgetId, Partial<DashboardWidgetLayoutItem>>> = {},
): DashboardWidgetLayoutItem[] {
  const normalizedColumns = Math.max(1, columns);
  const occupied = new Set<string>();
  const items: DashboardWidgetLayoutItem[] = [];

  const canPlace = (x: number, y: number, w: number, h: number) => {
    if (x + w > columns) return false;
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        if (occupied.has(`${col}:${row}`)) return false;
      }
    }
    return true;
  };

  const markPlaced = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        occupied.add(`${col}:${row}`);
      }
    }
  };

  for (const id of order) {
    const bounds = getWidgetBounds(id, normalizedColumns);
    const preferred = preferredById[id];
    const w = clamp(Math.round(Number(preferred?.w ?? bounds.defaultW)), bounds.minW, bounds.maxW);
    const h = clamp(Math.round(Number(preferred?.h ?? bounds.defaultH)), bounds.minH, bounds.maxH);
    const preferredX = clamp(Math.round(Number(preferred?.x ?? 0)), 0, Math.max(0, normalizedColumns - w));
    const preferredY = Math.max(0, Math.round(Number(preferred?.y ?? 0)));

    let placed = false;
    let y = preferredY;

    while (!placed && y < 200) {
      for (let x = preferredX; x <= normalizedColumns - w; x += 1) {
        if (!canPlace(x, y, w, h)) continue;
        markPlaced(x, y, w, h);
        items.push({ id, x, y, w, h });
        placed = true;
        break;
      }
      if (!placed) {
        for (let x = 0; x < preferredX; x += 1) {
          if (!canPlace(x, y, w, h)) continue;
          markPlaced(x, y, w, h);
          items.push({ id, x, y, w, h });
          placed = true;
          break;
        }
      }
      if (!placed) y += 1;
    }
  }

  return compactDashboardLayoutItems(items, normalizedColumns);
}

function normalizeDashboardLayoutItems(
  itemsValue: unknown,
  order: DashboardWidgetId[],
  columns = DASHBOARD_LAYOUT_COLUMNS_MAX,
): DashboardWidgetLayoutItem[] {
  const source = Array.isArray(itemsValue) ? itemsValue : [];
  const allowed = new Set<DashboardWidgetId>(defaultDashboardWidgetOrder);
  const preferred: Partial<Record<DashboardWidgetId, Partial<DashboardWidgetLayoutItem>>> = {};

  for (const candidate of source) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    const id = String(row.id || "").trim() as DashboardWidgetId;
    if (!allowed.has(id)) continue;
    preferred[id] = {
      id,
      x: Math.round(Number(row.x ?? 0)),
      y: Math.round(Number(row.y ?? 0)),
      w: Math.round(Number(row.w ?? dashboardWidgetDimensions[id].w)),
      h: Math.round(Number(row.h ?? dashboardWidgetDimensions[id].h)),
    };
  }

  return buildDashboardLayoutItems(order, columns, preferred);
}

function extractDashboardLayout(
  rawLayout: unknown,
  columns = DASHBOARD_LAYOUT_COLUMNS_MAX,
): PersistedDashboardLayout {
  if (Array.isArray(rawLayout)) {
    const order = normalizeDashboardWidgetOrder(rawLayout);
    return {
      order,
      items: buildDashboardLayoutItems(order, columns),
    };
  }

  const source = rawLayout && typeof rawLayout === "object" ? (rawLayout as Record<string, unknown>) : null;
  if (!source) {
    return {
      order: defaultDashboardWidgetOrder,
      items: buildDashboardLayoutItems(defaultDashboardWidgetOrder, columns),
    };
  }

  const legacyOrder = [
    ...(Array.isArray(source.top) ? source.top : []),
    ...(Array.isArray(source.operational) ? source.operational : []),
    ...(Array.isArray(source.main) ? source.main : []),
    ...(Array.isArray(source.base) ? source.base : []),
  ];
  const orderSource = Array.isArray(source.order) ? source.order : legacyOrder;
  const order = normalizeDashboardWidgetOrder(orderSource);

  return {
    order,
    items: normalizeDashboardLayoutItems(source.items, order, columns),
  };
}

function normalizeDashboardLayoutSnapshot(
  layout: PersistedDashboardLayout,
  columns = DASHBOARD_LAYOUT_COLUMNS_MAX,
): PersistedDashboardLayout {
  const order = normalizeDashboardWidgetOrder(layout.order);
  const items = normalizeDashboardLayoutItems(layout.items, order, columns);
  return { order, items };
}

function getDashboardLayoutSnapshot(
  userId: string,
  columns = DASHBOARD_LAYOUT_COLUMNS_MAX,
): PersistedDashboardLayout {
  if (typeof window === "undefined") {
    return {
      order: defaultDashboardWidgetOrder,
      items: buildDashboardLayoutItems(defaultDashboardWidgetOrder, columns),
    };
  }

  try {
    const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return {
        order: defaultDashboardWidgetOrder,
        items: buildDashboardLayoutItems(defaultDashboardWidgetOrder, columns),
      };
    }
    const parsed = JSON.parse(raw);
    const byUser = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    return extractDashboardLayout(byUser[userId] || byUser[DASHBOARD_GUEST_USER_KEY] || defaultDashboardWidgetOrder, columns);
  } catch {
    return {
      order: defaultDashboardWidgetOrder,
      items: buildDashboardLayoutItems(defaultDashboardWidgetOrder, columns),
    };
  }
}

function setDashboardLayoutSnapshot(
  userId: string,
  layout: PersistedDashboardLayout,
  columns = DASHBOARD_LAYOUT_COLUMNS_MAX,
) {
  if (typeof window === "undefined") return;
  const normalizedLayout = normalizeDashboardLayoutSnapshot(layout, columns);

  try {
    const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const byUser = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    byUser[userId] = normalizedLayout;
    window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(byUser));
  } catch {
    window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify({ [userId]: normalizedLayout }));
  }
}

function mapGridLayoutToDashboardItems(layout: ReactGridLayoutItem[]): DashboardWidgetLayoutItem[] {
  const allowed = new Set<DashboardWidgetId>(defaultDashboardWidgetOrder);
  const converted: DashboardWidgetLayoutItem[] = [];

  for (const row of layout) {
    const id = String(row.i || "").trim() as DashboardWidgetId;
    if (!allowed.has(id)) continue;
    converted.push({
      id,
      x: Math.round(Number(row.x ?? 0)),
      y: Math.round(Number(row.y ?? 0)),
      w: Math.round(Number(row.w ?? dashboardWidgetDimensions[id].w)),
      h: Math.round(Number(row.h ?? dashboardWidgetDimensions[id].h)),
    });
  }

  return converted;
}

function isSameDashboardLayoutItems(a: DashboardWidgetLayoutItem[], b: DashboardWidgetLayoutItem[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((left, right) => left.id.localeCompare(right.id));
  const sortedB = [...b].sort((left, right) => left.id.localeCompare(right.id));
  for (let index = 0; index < sortedA.length; index += 1) {
    const left = sortedA[index];
    const right = sortedB[index];
    if (!left || !right) return false;
    if (left.id !== right.id) return false;
    if (left.x !== right.x || left.y !== right.y || left.w !== right.w || left.h !== right.h) return false;
  }
  return true;
}

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

function useCountUp(target: number, duration = 800): number {
  const [displayValue, setDisplayValue] = useState(target);
  const previousValueRef = useRef(target);

  useEffect(() => {
    const startValue = previousValueRef.current;
    const endValue = target;
    previousValueRef.current = target;

    if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || startValue === endValue) {
      setDisplayValue(endValue);
      return;
    }

    let animationFrame = 0;
    const startAt = typeof performance !== "undefined" ? performance.now() : Date.now();

    const step = (timestamp: number) => {
      const elapsed = timestamp - startAt;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = startValue + (endValue - startValue) * eased;
      setDisplayValue(next);
      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(step);
      }
    };

    animationFrame = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [duration, target]);

  return displayValue;
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
  const isDashboardMode = filter === "all";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser } = useAuth();
  const responsaveis = useResponsaveis();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openedFromQueryRef = useRef<string | null>(null);

  const [leads, setLeads] = useState<Lead[]>(() => getLeadsSnapshot().map(normalizeLead));
  const [meetings, setMeetings] = useState<Meeting[]>(() => getMeetingsSnapshot());
  const [leadFinalizations, setLeadFinalizations] = useState<LeadFinalizationRecord[]>(() => getLeadFinalizationsSnapshot());
  const [dashboardCallLogs, setDashboardCallLogs] = useState<CallLog[]>([]);
  const [dashboardWrapups, setDashboardWrapups] = useState<PostCallWrapup[]>(() => getPostCallWrapups());
  const [dashboardReferenceDate, setDashboardReferenceDate] = useState<Date>(() => new Date());
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardAnimateIn, setDashboardAnimateIn] = useState(false);
  const [dashboardLayoutItems, setDashboardLayoutItems] = useState<DashboardWidgetLayoutItem[]>(() =>
    buildDashboardLayoutItems(defaultDashboardWidgetOrder),
  );
  const [dashboardViewportWidth, setDashboardViewportWidth] = useState<number>(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  const [dashboardActiveWidgetId, setDashboardActiveWidgetId] = useState<DashboardWidgetId | null>(null);
  const [dashboardIsInteracting, setDashboardIsInteracting] = useState(false);
  const [draftLead, setDraftLead] = useState<Lead | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInitialTab, setDetailInitialTab] = useState<"resumo" | "historico" | "qualificacao" | "observacoes" | "agenda">(
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

  const dashboardLayoutUserId = useMemo(() => {
    return String(currentUser?.id || DASHBOARD_GUEST_USER_KEY).trim() || DASHBOARD_GUEST_USER_KEY;
  }, [currentUser?.id]);

  useEffect(() => {
    if (!isDashboardMode || typeof window === "undefined") return;
    const handleResize = () => setDashboardViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [isDashboardMode]);

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
        const response = await fetch("/api/integracoes/analise-ia/observacoes", {
          method: "GET",
          cache: "no-store",
        });
        const data = (await response.json()) as LeadAiObservationResponse;
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

  useEffect(() => {
    if (!isDashboardMode) return;
    setMeetings(getMeetingsSnapshot());
    return subscribeMeetingsSnapshot(() => {
      setMeetings(getMeetingsSnapshot());
    });
  }, [isDashboardMode]);

  useEffect(() => {
    if (!isDashboardMode) return;
    setLeadFinalizations(getLeadFinalizationsSnapshot());
    return subscribeLeadFinalizationsSnapshot(() => {
      setLeadFinalizations(getLeadFinalizationsSnapshot());
    });
  }, [isDashboardMode]);

  useEffect(() => {
    if (!isDashboardMode) return;

    let cancelled = false;
    const loadCallLogs = async (showLoading: boolean) => {
      if (showLoading) setDashboardLoading(true);
      try {
        const response = await fetch("/api/ligacoes", {
          method: "GET",
          cache: "no-store",
        });
        const data = (await response.json()) as { success?: boolean; calls?: CallLog[]; message?: string };
        if (cancelled) return;
        if (!response.ok || !data.success || !Array.isArray(data.calls)) {
          if (showLoading) {
            setDashboardError(data.message || "Nao foi possivel carregar as ligacoes para o painel.");
          }
          return;
        }
        setDashboardCallLogs(data.calls);
        setDashboardError(null);
      } catch {
        if (!cancelled && showLoading) {
          setDashboardError("Nao foi possivel carregar as ligacoes para o painel.");
        }
      } finally {
        if (!cancelled && showLoading) {
          setDashboardLoading(false);
        }
      }
    };

    void loadCallLogs(true);
    const intervalId = window.setInterval(() => {
      void loadCallLogs(false);
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isDashboardMode]);

  useEffect(() => {
    if (!isDashboardMode) return;
    setDashboardWrapups(getPostCallWrapups());
    return subscribePostCallFlow(() => {
      setDashboardWrapups(getPostCallWrapups());
    });
  }, [isDashboardMode]);

  useEffect(() => {
    if (!isDashboardMode) return;
    setDashboardReferenceDate(new Date());
    const intervalId = window.setInterval(() => {
      setDashboardReferenceDate(new Date());
    }, 60000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isDashboardMode]);

  useEffect(() => {
    if (!isDashboardMode) return;
    setDashboardLayoutItems(getDashboardLayoutSnapshot(dashboardLayoutUserId, DASHBOARD_LAYOUT_COLUMNS_MAX).items);
  }, [dashboardLayoutUserId, isDashboardMode]);

  useEffect(() => {
    if (!isDashboardMode) return;
    const normalizedItems = normalizeDashboardLayoutItems(
      dashboardLayoutItems,
      normalizeDashboardWidgetOrder(dashboardLayoutItems.map((item) => item.id)),
      DASHBOARD_LAYOUT_COLUMNS_MAX,
    );
    const normalizedOrder = normalizeDashboardWidgetOrder(
      [...normalizedItems].sort((a, b) => a.y - b.y || a.x - b.x).map((item) => item.id),
    );
    setDashboardLayoutSnapshot(dashboardLayoutUserId, {
      order: normalizedOrder,
      items: normalizedItems,
    });
  }, [dashboardLayoutItems, dashboardLayoutUserId, isDashboardMode]);

  useEffect(() => {
    if (isDashboardMode) return;
    setDashboardActiveWidgetId(null);
    setDashboardIsInteracting(false);
  }, [isDashboardMode]);

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

  const dashboardMetrics = useMemo(() => {
    return buildOutboundDashboardMetrics({
      leads,
      meetings,
      callLogs: dashboardCallLogs,
      wrapups: dashboardWrapups,
      finalizations: leadFinalizations,
      referenceDate: dashboardReferenceDate,
    });
  }, [dashboardCallLogs, dashboardReferenceDate, dashboardWrapups, leadFinalizations, leads, meetings]);

  const animatedConversionRate = useCountUp(dashboardMetrics.taxaConversao, 860);
  const animatedCoverageRatio = useCountUp(dashboardMetrics.coberturaBaseRatio, 860);
  const animatedCoveragePercent = useCountUp(dashboardMetrics.coberturaBasePercent, 860);
  const animatedTotalLeadsProspectados = useCountUp(dashboardMetrics.totalLeadsProspectados, 760);
  const animatedTotalCallsAgendadas = useCountUp(dashboardMetrics.totalCallsAgendadas, 760);
  const animatedTotalLeadsFinalizados = useCountUp(dashboardMetrics.totalLeadsFinalizados, 760);
  const animatedTotalComprasEfetuadas = useCountUp(dashboardMetrics.totalComprasEfetuadas, 760);
  const animatedValorTotalFeitoCents = useCountUp(dashboardMetrics.valorTotalFeitoCents, 760);
  const animatedTotalFollowupsPendentes = useCountUp(dashboardMetrics.totalFollowupsPendentes, 760);
  const animatedTotalEmailsEnviados = useCountUp(dashboardMetrics.totalEmailsEnviados, 760);
  const animatedTotalLigacoesFeitas = useCountUp(dashboardMetrics.totalLigacoesFeitas, 760);

  const dashboardConversionRateLabel = useMemo(() => {
    return `${animatedConversionRate.toFixed(1).replace(".", ",")}%`;
  }, [animatedConversionRate]);

  const dashboardCoverageLabel = useMemo(() => {
    return `${animatedCoverageRatio.toFixed(2).replace(".", ",")} ligacoes/lead`;
  }, [animatedCoverageRatio]);

  const dashboardCoveragePercentLabel = useMemo(() => {
    return `${animatedCoveragePercent.toFixed(1).replace(".", ",")}%`;
  }, [animatedCoveragePercent]);

  const dashboardValorTotalFeitoLabel = useMemo(() => {
    return formatSaleValueCents(Math.round(animatedValorTotalFeitoCents));
  }, [animatedValorTotalFeitoCents]);

  const dashboardFunnelSteps = useMemo(
    () => [
      {
        label: "Leads Prospectados",
        value: dashboardMetrics.funnel.leadsProspectados,
        borderClass: "border-[#3B82F6]/45",
        gradientClass: "from-[#3B82F6] to-[#1D4ED8]",
        glowShadow: "0 0 20px rgba(59,130,246,0.15)",
      },
      {
        label: "Ligacoes Atendidas",
        value: dashboardMetrics.funnel.ligacoesAtendidas,
        borderClass: "border-[#8B5CF6]/45",
        gradientClass: "from-[#8B5CF6] to-[#6D28D9]",
        glowShadow: "0 0 20px rgba(139,92,246,0.15)",
      },
      {
        label: "Contato com Decisor",
        value: dashboardMetrics.funnel.contatosComDecisor,
        borderClass: "border-[#F59E0B]/50",
        gradientClass: "from-[#F59E0B] to-[#B45309]",
        glowShadow: "0 0 20px rgba(245,158,11,0.16)",
      },
      {
        label: "Calls Agendadas",
        value: dashboardMetrics.funnel.callsAgendadas,
        borderClass: "border-[#22C55E]/45",
        gradientClass: "from-[#22C55E] to-[#15803D]",
        glowShadow: "0 0 20px rgba(34,197,94,0.15)",
      },
    ],
    [dashboardMetrics.funnel.callsAgendadas, dashboardMetrics.funnel.contatosComDecisor, dashboardMetrics.funnel.leadsProspectados, dashboardMetrics.funnel.ligacoesAtendidas],
  );

  const dashboardFunnelMaxValue = useMemo(() => {
    return Math.max(1, ...dashboardFunnelSteps.map((step) => step.value));
  }, [dashboardFunnelSteps]);

  const dashboardActivities = useMemo(
    () => [
      {
        label: "Emails Enviados",
        value: dashboardMetrics.totalEmailsEnviados,
        animatedValue: Math.max(0, Math.round(animatedTotalEmailsEnviados)),
        barClass: "bg-gradient-to-r from-[#3B82F6] to-[#60A5FA]",
        metricClass: "text-[#93C5FD]",
      },
      {
        label: "Ligacoes Feitas",
        value: dashboardMetrics.totalLigacoesFeitas,
        animatedValue: Math.max(0, Math.round(animatedTotalLigacoesFeitas)),
        barClass: "bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA]",
        metricClass: "text-[#C4B5FD]",
      },
    ],
    [animatedTotalEmailsEnviados, animatedTotalLigacoesFeitas, dashboardMetrics.totalEmailsEnviados, dashboardMetrics.totalLigacoesFeitas],
  );

  const dashboardActivitiesMaxValue = useMemo(() => {
    return Math.max(1, ...dashboardActivities.map((activity) => activity.value));
  }, [dashboardActivities]);

  const dashboardGridColumns = useMemo(() => {
    return resolveDashboardGridColumns(dashboardViewportWidth);
  }, [dashboardViewportWidth]);

  const dashboardLayoutForViewport = useMemo(() => {
    return scaleDashboardLayoutItems(dashboardLayoutItems, DASHBOARD_LAYOUT_COLUMNS_MAX, dashboardGridColumns);
  }, [dashboardGridColumns, dashboardLayoutItems]);

  const dashboardLayoutById = useMemo(() => {
    return toLayoutRecord(dashboardLayoutForViewport);
  }, [dashboardLayoutForViewport]);

  const dashboardGridLayout = useMemo<ReactGridLayoutItem[]>(() => {
    const order = normalizeDashboardWidgetOrder(
      [...dashboardLayoutForViewport].sort((a, b) => a.y - b.y || a.x - b.x).map((item) => item.id),
    );
    const preferredById = toLayoutRecord(dashboardLayoutForViewport);
    const normalized = buildDashboardLayoutItems(order, dashboardGridColumns, preferredById);
    return normalized.map((item) => {
      const bounds = getWidgetBounds(item.id, dashboardGridColumns);
      return {
        i: item.id,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: bounds.minW,
        minH: bounds.minH,
        maxW: bounds.maxW,
        maxH: bounds.maxH,
      };
    });
  }, [dashboardGridColumns, dashboardLayoutForViewport]);

  const dashboardCardBaseClass =
    "group relative overflow-hidden rounded-2xl bg-[#0F172A]/95 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_16px_34px_rgba(2,6,23,0.35)] backdrop-blur transition-all duration-200 hover:-translate-y-[2px] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.3)]";

  const dashboardLabelClass = "text-xs uppercase tracking-[0.08em] text-slate-400";

  const syncDashboardLayoutFromGrid = (layout: ReactGridLayoutItem[]) => {
    const currentItems = mapGridLayoutToDashboardItems(layout);
    if (currentItems.length === 0) return;

    const currentOrder = normalizeDashboardWidgetOrder(
      [...currentItems].sort((a, b) => a.y - b.y || a.x - b.x).map((item) => item.id),
    );
    const normalizedCurrent = normalizeDashboardLayoutItems(currentItems, currentOrder, dashboardGridColumns);
    const baseItems = scaleDashboardLayoutItems(normalizedCurrent, dashboardGridColumns, DASHBOARD_LAYOUT_COLUMNS_MAX);
    setDashboardLayoutItems((prev) => (isSameDashboardLayoutItems(prev, baseItems) ? prev : baseItems));
  };

  const getWidgetDisplayMode = (widgetId: DashboardWidgetId): "compact" | "balanced" | "expanded" => {
    const layoutItem = dashboardLayoutById[widgetId];
    const width = layoutItem?.w ?? dashboardWidgetDimensions[widgetId].w;
    const height = layoutItem?.h ?? dashboardWidgetDimensions[widgetId].h;
    const area = width * height;
    if (area <= 4 || width <= 2 || height <= 1) return "compact";
    if (area >= 14 || width >= 6 || height >= 4) return "expanded";
    return "balanced";
  };

  const renderDashboardWidget = (widgetId: DashboardWidgetId) => {
    const displayMode = getWidgetDisplayMode(widgetId);
    const isCompact = displayMode === "compact";
    const isExpanded = displayMode === "expanded";
    const titleClass = isCompact ? "text-[10px]" : "text-xs";
    const valueClass = isCompact ? "mt-2 text-[24px]" : isExpanded ? "mt-4 text-[36px]" : "mt-3 text-[30px]";
    const helperClass = isCompact ? "mt-1 text-[11px]" : "mt-2 text-xs";

    const content =
      widgetId === "taxa_conversao" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Taxa de Conversao</p>
          <p className={`${valueClass} font-semibold tracking-[-0.03em] text-[#22C55E]`}>{dashboardConversionRateLabel}</p>
          <p className={`${helperClass} text-slate-300`}>Calls agendadas / contatos com decisor ({dashboardMetrics.totalContatosDecisor})</p>
        </>
      ) : widgetId === "cobertura_base" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Cobertura da Base</p>
          <p className={`${valueClass} font-semibold tracking-[-0.03em] text-[#3B82F6]`}>{dashboardCoveragePercentLabel}</p>
          <p className={`${helperClass} text-slate-300`}>
            {dashboardMetrics.totalLigacoesFeitas} ligacoes / {dashboardMetrics.totalLeadsAtivos} leads ativos
          </p>
          <p className={`${isCompact ? "mt-1" : "mt-2"} text-[11px] uppercase tracking-[0.08em] text-slate-500`}>{dashboardCoverageLabel}</p>
        </>
      ) : widgetId === "leads_finalizados" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Leads Finalizados</p>
          <p className={`${valueClass} font-semibold tracking-[-0.03em] text-white`}>
            {Math.max(0, Math.round(animatedTotalLeadsFinalizados))}
          </p>
          <p className={`${helperClass} text-slate-400`}>Finalizacao oficial via visao personalizada</p>
        </>
      ) : widgetId === "compras_efetuadas" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Compras Efetuadas</p>
          <p className={`${valueClass} font-semibold tracking-[-0.03em] text-[#22C55E]`}>
            {Math.max(0, Math.round(animatedTotalComprasEfetuadas))}
          </p>
          <p className={`${helperClass} text-slate-400`}>Leads convertidos em clientes</p>
        </>
      ) : widgetId === "valor_total_feito" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Valor Total Feito</p>
          <p className={`${valueClass} font-semibold tracking-[-0.03em] text-[#22C55E]`}>{dashboardValorTotalFeitoLabel}</p>
          <p className={`${helperClass} text-slate-400`}>Soma oficial das vendas por Compra efetuada</p>
        </>
      ) : widgetId === "leads_prospectados" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Leads Prospectados</p>
          <p className={`${valueClass} font-semibold tracking-[-0.02em] text-[#3B82F6]`}>
            {Math.max(0, Math.round(animatedTotalLeadsProspectados))}
          </p>
        </>
      ) : widgetId === "calls_agendadas" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Calls Agendadas</p>
          <p className={`${valueClass} font-semibold tracking-[-0.02em] text-[#22C55E]`}>
            {Math.max(0, Math.round(animatedTotalCallsAgendadas))}
          </p>
        </>
      ) : widgetId === "ligacoes_feitas" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Ligacoes Feitas</p>
          <p className={`${valueClass} font-semibold tracking-[-0.02em] text-[#8B5CF6]`}>
            {Math.max(0, Math.round(animatedTotalLigacoesFeitas))}
          </p>
        </>
      ) : widgetId === "emails_enviados" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Emails Enviados</p>
          <p className={`${valueClass} font-semibold tracking-[-0.02em] text-[#3B82F6]`}>
            {Math.max(0, Math.round(animatedTotalEmailsEnviados))}
          </p>
        </>
      ) : widgetId === "funil_vendas" ? (
        <div className="flex h-full flex-col">
          <div className={`${isCompact ? "mb-2" : "mb-3"} flex items-center justify-between gap-2`}>
            <p className={dashboardLabelClass}>Funil de Vendas Outbound</p>
            {!isCompact ? <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Etapas consolidadas da operacao</p> : null}
          </div>
          <div className={`${isCompact ? "pt-0.5" : "pt-1"} flex-1`}>
            {dashboardFunnelSteps.map((step, index) => {
              const width =
                step.value <= 0 ? 36 : Math.max(38, Math.min(100, Math.round((step.value / dashboardFunnelMaxValue) * 100)));
              return (
                <div key={step.label} className={index === 0 ? "" : isCompact ? "-mt-1" : "-mt-2"}>
                  <div
                    className={`relative overflow-hidden rounded-full shadow-[0_14px_22px_rgba(2,6,23,0.34)] ${isCompact ? "h-7" : isExpanded ? "h-10" : "h-9"}`}
                    style={{
                      width: dashboardAnimateIn ? `${width}%` : "0%",
                      transitionDelay: `${index * 90}ms`,
                      transitionProperty: "width",
                      transitionDuration: "0.8s",
                      transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)",
                      boxShadow: `${step.glowShadow}, 0 14px 22px rgba(2,6,23,0.34)`,
                    }}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-r ${step.gradientClass}`} />
                    <div className={`absolute inset-0 border ${step.borderClass}`} />
                    <div className={`relative flex h-full items-center justify-between ${isCompact ? "px-2.5" : "px-4"}`}>
                      <span className={`${isCompact ? "text-[10px]" : "text-[11px]"} font-medium uppercase tracking-[0.08em] text-slate-100`}>
                        {step.label}
                      </span>
                      <span className={`${isCompact ? "text-xs" : "text-sm"} font-semibold text-white`}>{step.value}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : widgetId === "atividades_bdr" ? (
        <div className="flex h-full flex-col">
          <div className={`${isCompact ? "mb-2" : "mb-4"} flex items-center justify-between gap-2`}>
            <p className={dashboardLabelClass}>Atividades (BDR)</p>
            {!isCompact ? <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Email + ligacoes</p> : null}
          </div>
          <div className={`${isCompact ? "space-y-2" : "space-y-4"} flex-1`}>
            {dashboardActivities.map((activity, index) => {
              const width =
                activity.value <= 0 ? 8 : Math.max(14, Math.min(100, Math.round((activity.value / dashboardActivitiesMaxValue) * 100)));
              return (
                <div
                  key={activity.label}
                  className={`rounded-xl bg-[#111827]/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] ${isCompact ? "p-2.5" : "p-4"}`}
                >
                  <div className={`flex items-center justify-between gap-2 ${isCompact ? "text-[11px]" : "text-xs"} text-slate-300`}>
                    <span>{activity.label}</span>
                    <span className={`${isCompact ? "text-lg" : "text-2xl"} font-semibold tracking-[-0.02em] ${activity.metricClass}`}>
                      {activity.animatedValue}
                    </span>
                  </div>
                  <div className={`${isCompact ? "mt-2 h-2" : "mt-3 h-2.5"} overflow-hidden rounded-full bg-slate-900/80`}>
                    <div
                      className={`h-full rounded-full transition-[width] duration-[600ms] ease-out ${activity.barClass}`}
                      style={{
                        width: dashboardAnimateIn ? `${width}%` : "0%",
                        transitionDelay: `${index * 90}ms`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : widgetId === "followups_pendentes" ? (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Follow-ups Pendentes</p>
          <p className={`${valueClass} font-semibold tracking-[-0.02em] text-[#F59E0B]`}>
            {Math.max(0, Math.round(animatedTotalFollowupsPendentes))}
          </p>
          <p className={`${helperClass} text-slate-400`}>Follow-ups futuros com status ativo</p>
        </>
      ) : (
        <>
          <p className={`${dashboardLabelClass} ${titleClass}`}>Taxa de Conversao (Indicador)</p>
          <p className={`${valueClass} font-semibold tracking-[-0.02em] text-[#22C55E]`}>{dashboardConversionRateLabel}</p>
          <p className={`${helperClass} text-slate-400`}>
            {dashboardMetrics.totalCallsAgendadas} calls agendadas para {dashboardMetrics.totalContatosDecisor} contatos com decisor
          </p>
        </>
      );

    return (
      <article
        key={widgetId}
        className={`${dashboardCardBaseClass} h-full min-w-0 ${dashboardActiveWidgetId === widgetId && dashboardIsInteracting ? "ring-2 ring-sky-400/70" : ""}`}
      >
        <span className="crm-widget-drag-handle absolute right-3 top-3 select-none text-xs tracking-[0.12em] text-slate-500 cursor-move">::</span>
        {content}
      </article>
    );
  };

  const dashboardAnimationSeed = useMemo(() => {
    return [
      dashboardMetrics.totalLeadsProspectados,
      dashboardMetrics.totalCallsAgendadas,
      dashboardMetrics.taxaConversao.toFixed(3),
      dashboardMetrics.totalEmailsEnviados,
      dashboardMetrics.totalLigacoesFeitas,
      dashboardMetrics.totalFollowupsPendentes,
      dashboardMetrics.valorTotalFeitoCents,
    ].join("|");
  }, [
    dashboardMetrics.taxaConversao,
    dashboardMetrics.totalCallsAgendadas,
    dashboardMetrics.totalEmailsEnviados,
    dashboardMetrics.totalFollowupsPendentes,
    dashboardMetrics.totalLeadsProspectados,
    dashboardMetrics.totalLigacoesFeitas,
    dashboardMetrics.valorTotalFeitoCents,
  ]);

  useEffect(() => {
    if (!isDashboardMode) return;
    setDashboardAnimateIn(false);
    const timeoutId = window.setTimeout(() => {
      setDashboardAnimateIn(true);
    }, 70);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [dashboardAnimationSeed, isDashboardMode]);

  const detailLead = useMemo(() => leads.find((lead) => lead.id === detailLeadId) ?? null, [detailLeadId, leads]);

  useEffect(() => {
    if (isDashboardMode) return;
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
            : requestedTab === "agenda"
              ? "agenda"
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
  }, [isDashboardMode, leads, router, searchParams]);

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

  const finalizeLeadViaProfile = (leadToFinalize: Lead, reason: LeadFinalizationReason, saleValueCents?: number): boolean => {
    const resolvedLead = leads.find((lead) => lead.id === leadToFinalize.id) || leadToFinalize;
    const finalizedAt = new Date();
    const finalizedAtIso = finalizedAt.toISOString();
    const stamp = nowStamp();
    const finalizedBy = resolvedLead.owner || "Time Comercial";
    const safeSaleValueCents = Number.isFinite(saleValueCents) ? Math.round(Number(saleValueCents)) : 0;

    if (reason === "compra_efetuada" && !isValidSaleValueCents(safeSaleValueCents)) {
      return false;
    }

    const finalizationRecord: LeadFinalizationRecord = {
      id: `LF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      leadId: resolvedLead.id,
      leadName: resolvedLead.name || "-",
      leadCompany: resolvedLead.company || "-",
      channel: resolvedLead.channel,
      reason,
      finalizedAt: finalizedAtIso,
      finalizedBy,
      finalizationSource: "lead_profile",
      finalizedViaLeadProfile: true,
      convertedToCustomerAt: reason === "compra_efetuada" ? finalizedAtIso : null,
      saleValueCents: reason === "compra_efetuada" ? safeSaleValueCents : null,
    };

    setLeads((prev) => prev.filter((lead) => lead.id !== resolvedLead.id));

    if (reason === "compra_efetuada") {
      const finalizedCustomerLead: Lead = {
        ...resolvedLead,
        status: "Fechado",
        finalizedAt: finalizedAtIso,
        finalizedBy,
        finalizationReason: "compra_efetuada",
        finalizationSource: "lead_profile",
        finalizedViaLeadProfile: true,
        convertedToCustomerAt: finalizedAtIso,
        customerStatus: "cliente",
        saleValueCents: safeSaleValueCents,
        history: [
          ...resolvedLead.history,
          historyEvent(
            finalizedBy,
            "LEAD_FINALIZADO",
            `Lead finalizado como compra efetuada e movido para Clientes. Valor registrado: ${formatSaleValueCents(safeSaleValueCents)}.`,
          ),
          {
            id: `H-CUSTOMER-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            date: stamp.date,
            time: stamp.time,
            eventType: "CLIENTE",
            description: `Lead convertido em cliente com venda de ${formatSaleValueCents(safeSaleValueCents)}.`,
            owner: finalizedBy,
          },
        ],
      };

      const currentCustomers = getCustomersSnapshot();
      const nextCustomers = [...currentCustomers.filter((lead) => lead.id !== finalizedCustomerLead.id), finalizedCustomerLead];
      setCustomersSnapshot(nextCustomers);
    }

    const currentFinalizations = getLeadFinalizationsSnapshot();
    const nextFinalizations = [finalizationRecord, ...currentFinalizations];
    setLeadFinalizationsSnapshot(nextFinalizations);
    setLeadFinalizations(nextFinalizations);

    setDetailOpen(false);
    setDetailLeadId(null);
    setDetailInitialTab("resumo");
    setDetailInitialObservationId(null);

    return true;
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
          isDashboardMode ? (
            <button
              type="button"
              className="btn-ghost h-10 px-4 text-sm"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
            >
              Atualizar pagina
            </button>
          ) : (
            <div ref={addMenuRef} className="relative">
              <button
                type="button"
                className="btn-primary flex h-10 items-center gap-1.5 px-4"
                onClick={() => setAddMenuOpen((prev) => !prev)}
                aria-haspopup="true"
                aria-expanded={addMenuOpen}
              >
                Adicionar Lead
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className={`h-3.5 w-3.5 transition-transform ${addMenuOpen ? "rotate-180" : ""}`}
                >
                  <path
                    d="M4 6l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
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
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      className="h-4 w-4 shrink-0 text-slate-400"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
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
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      className="h-4 w-4 shrink-0 text-slate-400"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M9 3L5 8h4l-2 5 6-7H9l2-3z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Automatizado
                  </button>
                </div>
              ) : null}
            </div>
          )
        }
      />

      {isDashboardMode ? (
        <section className="rounded-2xl bg-[#0B1220] p-3 md:p-4">
          <div className="relative overflow-hidden rounded-2xl bg-[#0F172A]/95 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_22px_46px_rgba(2,6,23,0.42)] backdrop-blur md:p-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_44%)]" />
            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={dashboardLabelClass}>Painel de acompanhamento - Outbound</p>
                <p className="mt-1.5 max-w-3xl text-sm text-slate-300">
                  Visao consolidada da operacao outbound com funil, atividades e indicadores de conversao.
                </p>
              </div>
              <p className="rounded-lg bg-[#111827] px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] text-slate-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
                Atualizado em {dashboardReferenceDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>

            {dashboardLoading ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="dashboard-skeleton-shimmer h-12 rounded-xl" />
                ))}
              </div>
            ) : dashboardError ? (
              <p className="mt-3 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {dashboardError}
              </p>
            ) : null}
          </div>

          <DashboardGridLayout
            className="crm-dashboard-grid mt-3"
            layout={dashboardGridLayout}
            cols={dashboardGridColumns}
            rowHeight={DASHBOARD_LAYOUT_ROW_HEIGHT}
            margin={[DASHBOARD_LAYOUT_GAP, DASHBOARD_LAYOUT_GAP]}
            containerPadding={[0, 0]}
            compactType="vertical"
            preventCollision={false}
            autoSize
            isDraggable
            isResizable
            resizeHandles={["s", "e", "se"]}
            draggableHandle=".crm-widget-drag-handle"
            onLayoutChange={syncDashboardLayoutFromGrid}
            onDragStart={(_, item) => {
              setDashboardIsInteracting(true);
              setDashboardActiveWidgetId(String(item.i || "") as DashboardWidgetId);
            }}
            onResizeStart={(_, item) => {
              setDashboardIsInteracting(true);
              setDashboardActiveWidgetId(String(item.i || "") as DashboardWidgetId);
            }}
            onDragStop={(layout) => {
              syncDashboardLayoutFromGrid(layout);
              setDashboardIsInteracting(false);
              setDashboardActiveWidgetId(null);
            }}
            onResizeStop={(layout) => {
              syncDashboardLayoutFromGrid(layout);
              setDashboardIsInteracting(false);
              setDashboardActiveWidgetId(null);
            }}
          >
            {defaultDashboardWidgetOrder.map((widgetId) => (
              <div key={widgetId}>{renderDashboardWidget(widgetId)}</div>
            ))}
          </DashboardGridLayout>

          <style jsx>{`
            @keyframes dashboard-shimmer {
              0% {
                background-position: 200% 0;
              }
              100% {
                background-position: -200% 0;
              }
            }

            .dashboard-skeleton-shimmer {
              background-image: linear-gradient(
                90deg,
                rgba(30, 41, 59, 0.75) 20%,
                rgba(71, 85, 105, 0.36) 50%,
                rgba(30, 41, 59, 0.75) 80%
              );
              background-size: 200% 100%;
              animation: dashboard-shimmer 1.4s linear infinite;
            }
          `}</style>
          <style jsx global>{`
            .crm-dashboard-grid .react-grid-item {
              transition: transform 190ms ease, width 190ms ease, height 190ms ease;
            }

            .crm-dashboard-grid .react-grid-item.react-grid-placeholder {
              border-radius: 16px;
              background: rgba(56, 189, 248, 0.18);
              border: 1px dashed rgba(56, 189, 248, 0.5);
            }

            .crm-dashboard-grid .react-grid-item > div {
              height: 100%;
            }

            .crm-dashboard-grid .react-resizable-handle {
              position: absolute;
              z-index: 20;
            }

            .crm-dashboard-grid .react-resizable-handle-se {
              right: 6px;
              bottom: 6px;
              width: 12px;
              height: 12px;
              border-right: 2px solid rgba(148, 163, 184, 0.7);
              border-bottom: 2px solid rgba(148, 163, 184, 0.7);
              cursor: se-resize;
            }

            .crm-dashboard-grid .react-resizable-handle-s {
              left: 50%;
              bottom: 4px;
              width: 26px;
              height: 7px;
              transform: translateX(-50%);
              cursor: s-resize;
            }

            .crm-dashboard-grid .react-resizable-handle-s::before {
              content: "";
              display: block;
              width: 100%;
              height: 2px;
              border-radius: 999px;
              background: rgba(148, 163, 184, 0.62);
            }

            .crm-dashboard-grid .react-resizable-handle-e {
              right: 4px;
              top: 50%;
              width: 7px;
              height: 26px;
              transform: translateY(-50%);
              cursor: e-resize;
            }

            .crm-dashboard-grid .react-resizable-handle-e::before {
              content: "";
              display: block;
              width: 2px;
              height: 100%;
              border-radius: 999px;
              background: rgba(148, 163, 184, 0.62);
              margin-left: auto;
            }
          `}</style>
        </section>
      ) : (
        <>
          <section className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-lg">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="6.5" cy="6.5" r="4.5" />
                <path d="M10.5 10.5l3 3" strokeLinecap="round" />
              </svg>
              <input
                className="field h-9 w-full pl-8 pr-3 text-[13px]"
                placeholder="Buscar por nome, empresa, telefone ou email..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                className="btn-ghost h-9 px-3 text-xs"
                onClick={() => {
                  if (typeof window !== "undefined") window.location.reload();
                }}
              >
                Atualizar
              </button>
              <div className="h-4 w-px bg-border" />
              <button type="button" className="btn-ghost h-9 px-3 text-xs" onClick={() => setImportOpen(true)}>
                Importar
              </button>
            </div>
          </section>

          {filter === "outbound" ? (
            <OutboundLeadsTable leads={visibleLeads} onSelectLead={openLeadDetails} onDeleteLeads={deleteLeadsById} />
          ) : (
            <LeadsTable
              leads={visibleLeads}
              onSelectLead={openLeadDetails}
              onSaveRow={updateLeadById}
              onDeleteLeads={deleteLeadsById}
            />
          )}
        </>
      )}

      {!isDashboardMode ? (
        <>
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
        onFinalizeLead={finalizeLeadViaProfile}
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
        </>
      ) : null}
    </section>
  );
}

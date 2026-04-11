import { Lead } from "@/types/crm";
import { LeadSectionCard } from "./lead-section-card";

type LeadGeneralTabProps = {
  lead: Lead;
  draftLead: Lead;
  isEditing: boolean;
  onActivateEdit: () => void;
  onEditingStateChange?: (editing: boolean) => void;
  onDraftChange: (next: Lead) => void;
};

function normalizeDisplay(value?: string | null): string {
  const text = String(value || "").trim();
  return text || "-";
}

function formatDateBR(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return raw;
  return raw;
}

function formatDateTimeBR(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";

  const normalized = raw.replace(" ", "T");
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const dateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?$/);
  if (dateMatch) {
    const [, year, month, day, time] = dateMatch;
    return time ? `${day}/${month}/${year} ${time}` : `${day}/${month}/${year}`;
  }

  return raw;
}

function resolveTelefoneGoogle(lead: Lead): string {
  const explicit = String(lead.telefone_google || "").trim();
  if (explicit) return explicit;

  const phones = Array.isArray(lead.phones)
    ? lead.phones.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (phones.length > 0) return phones[0];

  const primary = String(lead.phone || "").trim();
  return primary || "-";
}

function resolveTelefoneCnpj(lead: Lead): string {
  const explicit = String(lead.telefone_cnpj || "").trim();
  if (explicit) return explicit;

  const phones = Array.isArray(lead.phones)
    ? lead.phones.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (phones.length > 1) return phones[1];

  return "-";
}

function resolveCategoriasSecundarias(lead: Lead): string {
  if (Array.isArray(lead.categorias_secundarias) && lead.categorias_secundarias.length > 0) {
    return lead.categorias_secundarias.map((value) => String(value || "").trim()).filter(Boolean).join(", ") || "-";
  }

  const raw = String(lead.categorias_secundarias || "").trim();
  if (!raw) return "-";

  const values = raw
    .split(/[|;,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values.join(", ") : raw;
}

function SummaryField({
  label,
  value,
  fullWidth = false,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-border/80 bg-slate-950/40 px-3 py-2.5 ${fullWidth ? "md:col-span-2" : ""}`}>
      <p className="text-[11px] uppercase tracking-[0.09em] text-muted">{label}</p>
      <p className="mt-1.5 whitespace-pre-line text-sm text-slate-100">{normalizeDisplay(value)}</p>
    </div>
  );
}

export function LeadGeneralTab({ draftLead }: LeadGeneralTabProps) {
  const telefoneGoogle = resolveTelefoneGoogle(draftLead);
  const telefoneCnpj = resolveTelefoneCnpj(draftLead);
  const nomeFantasia = String(draftLead.nome_fantasia || "").trim() || draftLead.company;
  const enderecoCompleto = String(draftLead.endereco_completo || "").trim() || draftLead.city;
  const categoriaPrincipal = String(draftLead.categoria_principal || "").trim() || draftLead.niche;
  const categoriasSecundarias = resolveCategoriasSecundarias(draftLead);

  return (
    <div className="space-y-4">
      <LeadSectionCard title="Identificacao">
        <div className="grid gap-2 md:grid-cols-2">
          <SummaryField label="Email" value={draftLead.email} />
          <SummaryField label="Site" value={String(draftLead.site || "")} />

          <SummaryField label="Telefone Google" value={telefoneGoogle} />
          <SummaryField label="Telefone CNPJ" value={telefoneCnpj} />

          <SummaryField label="1o Contato" value={formatDateBR(draftLead.firstContactDate)} />
          <SummaryField label="Ultimo Contato" value={formatDateTimeBR(draftLead.lastInteraction)} />

          <SummaryField label="Cadastrado" value={formatDateBR(draftLead.entryDate)} />
          <SummaryField label="Nome Fantasia" value={nomeFantasia} />

          <SummaryField label="Endereco Completo" value={enderecoCompleto} fullWidth />

          <SummaryField label="Categoria Principal" value={categoriaPrincipal} />
          <SummaryField label="Categorias Secundarias" value={categoriasSecundarias} />

          <SummaryField label="Horario de Funcionamento" value={String(draftLead.horario_funcionamento || "")} fullWidth />
        </div>
      </LeadSectionCard>
    </div>
  );
}

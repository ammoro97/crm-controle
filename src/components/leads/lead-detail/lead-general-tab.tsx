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

function splitMultiValueText(value: string): string[] {
  return String(value || "")
    .split(/[\n\r|;,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePhoneDigits(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

function uniqPhones(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = normalizePhoneDigits(value) || value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }

  return next;
}

function parsePhoneColumn(value?: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return uniqPhones(value.flatMap((item) => splitMultiValueText(String(item || ""))));
  }
  return uniqPhones(splitMultiValueText(String(value || "")));
}

function resolveLegacyPhones(lead: Lead): string[] {
  const fromArray = Array.isArray(lead.phones) ? lead.phones : [];
  const merged = [
    ...fromArray.flatMap((item) => splitMultiValueText(String(item || ""))),
    ...splitMultiValueText(String(lead.phone || "")),
  ];
  return uniqPhones(merged);
}

function parseCategoriasSecundarias(value?: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitMultiValueText(String(item || "")));
  }
  return splitMultiValueText(String(value || ""));
}

function formatListForDisplay(values: string[]): string {
  return values.length > 0 ? values.join("\n") : "-";
}

function SummaryField({
  label,
  value,
  fullWidth = false,
  editable = false,
  isEditing = false,
  multiline = false,
  inputType = "text",
  onChange,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
  editable?: boolean;
  isEditing?: boolean;
  multiline?: boolean;
  inputType?: "text" | "email";
  onChange?: (value: string) => void;
}) {
  return (
    <div className={`rounded-lg border border-border/80 bg-slate-950/40 px-3 py-2.5 ${fullWidth ? "md:col-span-2" : ""}`}>
      <p className="text-[11px] uppercase tracking-[0.09em] text-muted">{label}</p>
      {editable && isEditing ? (
        multiline ? (
          <textarea
            className="field mt-1.5 min-h-20 px-2.5 py-1.5 text-sm"
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
          />
        ) : (
          <input
            className="field mt-1.5 h-9 px-2.5 py-1.5 text-sm"
            type={inputType}
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
          />
        )
      ) : (
        <p className="mt-1.5 whitespace-pre-line text-sm text-slate-100">{normalizeDisplay(value)}</p>
      )}
    </div>
  );
}

export function LeadGeneralTab({ draftLead, isEditing, onDraftChange }: LeadGeneralTabProps) {
  const explicitTelefoneGoogleList = parsePhoneColumn(draftLead.telefone_google);
  const explicitTelefoneCnpjList = parsePhoneColumn(draftLead.telefone_cnpj);
  const legacyPhones = resolveLegacyPhones(draftLead);
  const telefoneGoogleList =
    explicitTelefoneGoogleList.length > 0
      ? explicitTelefoneGoogleList
      : explicitTelefoneCnpjList.length === 0
        ? legacyPhones
        : [];
  const telefoneCnpjList = explicitTelefoneCnpjList;
  const telefoneGoogleDisplay = formatListForDisplay(telefoneGoogleList);
  const telefoneCnpjDisplay = formatListForDisplay(telefoneCnpjList);
  const nomeFantasia = String(draftLead.nome_fantasia || "").trim() || draftLead.company;
  const enderecoCompleto = String(draftLead.endereco_completo || "").trim() || draftLead.city;
  const categoriaPrincipal = String(draftLead.categoria_principal || "").trim() || draftLead.niche;
  const categoriasSecundariasList = parseCategoriasSecundarias(draftLead.categorias_secundarias);
  const categoriasSecundariasDisplay = formatListForDisplay(categoriasSecundariasList);
  const horarioFuncionamento = String(draftLead.horario_funcionamento || "").trim();

  return (
    <div className="space-y-4">
      <LeadSectionCard title="Identificacao">
        <div className="grid gap-2 md:grid-cols-2">
          <SummaryField
            label="Email"
            value={draftLead.email}
            editable
            isEditing={isEditing}
            inputType="email"
            onChange={(value) => onDraftChange({ ...draftLead, email: value })}
          />

          <SummaryField
            label="Telefone Google"
            value={isEditing ? telefoneGoogleList.join("\n") : telefoneGoogleDisplay}
            editable
            isEditing={isEditing}
            multiline
            onChange={(value) => {
              const nextGoogle = parsePhoneColumn(value);
              const nextPhones = uniqPhones([...nextGoogle, ...telefoneCnpjList]);
              onDraftChange({
                ...draftLead,
                telefone_google: nextGoogle.length > 0 ? nextGoogle : null,
                phones: nextPhones,
                phone: nextPhones[0] || "",
              });
            }}
          />
          <SummaryField
            label="Telefone CNPJ"
            value={isEditing ? telefoneCnpjList.join("\n") : telefoneCnpjDisplay}
            editable
            isEditing={isEditing}
            multiline
            onChange={(value) => {
              const nextCnpj = parsePhoneColumn(value);
              const nextPhones = uniqPhones([...explicitTelefoneGoogleList, ...nextCnpj]);
              onDraftChange({
                ...draftLead,
                telefone_cnpj: nextCnpj.length > 0 ? nextCnpj : null,
                phones: nextPhones,
                phone: nextPhones[0] || "",
              });
            }}
          />

          <SummaryField label="1o Contato" value={formatDateBR(draftLead.firstContactDate)} />
          <SummaryField label="Ultimo Contato" value={formatDateTimeBR(draftLead.lastInteraction)} />

          <SummaryField label="Cadastrado" value={formatDateBR(draftLead.entryDate)} />
          <SummaryField
            label="Nome Fantasia"
            value={nomeFantasia}
            editable
            isEditing={isEditing}
            onChange={(value) =>
              onDraftChange({
                ...draftLead,
                nome_fantasia: value.trim() ? value.trim() : null,
              })
            }
          />

          <SummaryField
            label="Endereco Completo"
            value={enderecoCompleto}
            fullWidth
            editable
            isEditing={isEditing}
            onChange={(value) =>
              onDraftChange({
                ...draftLead,
                endereco_completo: value.trim() ? value.trim() : null,
              })
            }
          />

          <SummaryField
            label="Categoria Principal"
            value={categoriaPrincipal}
            editable
            isEditing={isEditing}
            onChange={(value) =>
              onDraftChange({
                ...draftLead,
                categoria_principal: value.trim() ? value.trim() : null,
              })
            }
          />
          <SummaryField
            label="Categorias Secundarias"
            value={isEditing ? categoriasSecundariasList.join("\n") : categoriasSecundariasDisplay}
            editable
            isEditing={isEditing}
            multiline
            onChange={(value) => {
              const parsed = parseCategoriasSecundarias(value);
              onDraftChange({
                ...draftLead,
                categorias_secundarias: parsed.length > 0 ? parsed : null,
              });
            }}
          />

          <SummaryField
            label="Horario de Funcionamento"
            value={horarioFuncionamento}
            fullWidth
            editable
            isEditing={isEditing}
            multiline
            onChange={(value) =>
              onDraftChange({
                ...draftLead,
                horario_funcionamento: value.trim() ? value.trim() : null,
              })
            }
          />
        </div>
      </LeadSectionCard>
    </div>
  );
}

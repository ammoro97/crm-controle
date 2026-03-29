import { KeyboardEvent, useMemo, useState } from "react";
import {
  getLeadEmails,
  getLeadNames,
  getLeadPhones,
  updateLeadEmails,
  updateLeadNames,
  updateLeadPhones,
} from "@/lib/lead-contact-utils";
import { useResponsaveis } from "@/lib/responsaveis-store";
import { Lead } from "@/types/crm";
import {
  buyingMomentOptions,
  ChannelBadge,
  decisionOptions,
  getLeadCommercialData,
  icpOptions,
  revenueOptions,
  statusOptions,
  updateCommercialField,
} from "./lead-detail-shared";
import { LeadInlineField } from "./lead-inline-field";
import { LeadSectionCard } from "./lead-section-card";

type LeadGeneralTabProps = {
  lead: Lead;
  draftLead: Lead;
  isEditing: boolean;
  onActivateEdit: () => void;
  onDraftChange: (next: Lead) => void;
};

type MultiValueFieldProps = {
  label: string;
  values: string[];
  editable: boolean;
  isEditing: boolean;
  addButtonLabel: string;
  placeholder: string;
  onActivateEdit: () => void;
  onChange: (nextValues: string[]) => void;
};

function MultiValueField({
  label,
  values,
  editable,
  isEditing,
  addButtonLabel,
  placeholder,
  onActivateEdit,
  onChange,
}: MultiValueFieldProps) {
  const [pendingValue, setPendingValue] = useState("");
  const displayValues = values.length > 0 ? values : [""];

  const addValue = () => {
    const next = pendingValue.trim();
    if (!next) return;
    onChange([...values, next]);
    setPendingValue("");
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addValue();
    }
  };

  const updateAt = (index: number, value: string) => {
    const next = [...displayValues];
    next[index] = value;
    onChange(next);
  };

  const removeAt = (index: number) => {
    const next = displayValues.filter((_, idx) => idx !== index);
    onChange(next.length > 0 ? next : [""]);
  };

  return (
    <div
      className={`rounded-lg border border-border/80 bg-slate-950/40 px-3 py-2.5 ${editable && !isEditing ? "cursor-pointer transition hover:border-slate-600/80 hover:bg-slate-900/70" : ""}`}
      onClick={() => {
        if (editable && !isEditing) onActivateEdit();
      }}
      role={editable && !isEditing ? "button" : undefined}
      tabIndex={editable && !isEditing ? 0 : -1}
      onKeyDown={(event) => {
        if (editable && !isEditing && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onActivateEdit();
        }
      }}
    >
      <p className="text-[11px] uppercase tracking-[0.09em] text-muted">{label}</p>

      {isEditing ? (
        <>
          <div className="mt-1.5 space-y-2">
            {displayValues.map((value, index) => (
              <div key={`${label}-${index}`} className="flex items-center gap-2">
                <input
                  className="field h-9 flex-1 px-2.5 py-1.5 text-sm"
                  value={value}
                  placeholder={placeholder}
                  onChange={(event) => updateAt(index, event.target.value)}
                />
                <button
                  type="button"
                  className="rounded-md border border-border px-2.5 text-xs text-slate-200 transition hover:bg-slate-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeAt(index);
                  }}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="field h-9 flex-1 px-2.5 py-1.5 text-sm"
              placeholder={placeholder}
              value={pendingValue}
              onChange={(event) => setPendingValue(event.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <button
              type="button"
              className="rounded-md border border-border px-2.5 text-xs text-slate-200 transition hover:bg-slate-800"
              onClick={addValue}
            >
              {addButtonLabel}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-1.5 space-y-1">
          {values.length === 0 ? <p className="text-sm text-slate-100">-</p> : null}
          {values.map((value, index) => (
            <p key={`${value}-${index}`} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-100">
              {value}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function LeadGeneralTab({ lead, draftLead, isEditing, onActivateEdit, onDraftChange }: LeadGeneralTabProps) {
  const ownerOptions = useResponsaveis();
  const commercial = getLeadCommercialData(draftLead);
  const names = useMemo(() => getLeadNames(draftLead), [draftLead]);
  const phones = useMemo(() => getLeadPhones(draftLead), [draftLead]);
  const emails = useMemo(() => getLeadEmails(draftLead), [draftLead]);

  const hasFinancialData = useMemo(
    () =>
      Boolean(commercial.monthlyRevenueRange && commercial.monthlyRevenueRange !== "-") ||
      Boolean(commercial.averageLeadsPerMonth && commercial.averageLeadsPerMonth !== "-"),
    [commercial.averageLeadsPerMonth, commercial.monthlyRevenueRange],
  );

  return (
    <div className="space-y-4">
      <LeadSectionCard title="Identificacao" subtitle="Contexto essencial para reconhecer rapidamente o lead">
        <div className="grid gap-2 md:grid-cols-2">
          <MultiValueField
            label="Nome"
            values={names}
            editable
            isEditing={isEditing}
            addButtonLabel="+ adicionar nome"
            placeholder="Nome"
            onActivateEdit={onActivateEdit}
            onChange={(nextValues) => onDraftChange(updateLeadNames(draftLead, nextValues))}
          />
          <LeadInlineField
            label="Empresa"
            value={draftLead.company}
            editable
            isEditing={isEditing}
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange({ ...draftLead, company: value })}
          />
          <MultiValueField
            label="Telefone"
            values={phones}
            editable
            isEditing={isEditing}
            addButtonLabel="+ adicionar telefone"
            placeholder="Telefone"
            onActivateEdit={onActivateEdit}
            onChange={(nextValues) => onDraftChange(updateLeadPhones(draftLead, nextValues))}
          />
          <LeadInlineField
            label="Responsavel"
            value={draftLead.owner}
            editable
            isEditing={isEditing}
            type="select"
            selectOptions={ownerOptions}
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange({ ...draftLead, owner: value })}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <MultiValueField
            label="Email"
            values={emails}
            editable
            isEditing={isEditing}
            addButtonLabel="+ adicionar email"
            placeholder="Email"
            onActivateEdit={onActivateEdit}
            onChange={(nextValues) => onDraftChange(updateLeadEmails(draftLead, nextValues))}
          />
          <LeadInlineField
            label="Cidade"
            value={draftLead.city}
            editable
            isEditing={isEditing}
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange({ ...draftLead, city: value })}
          />
          <LeadInlineField
            label="Data de entrada"
            value={draftLead.entryDate || ""}
            editable
            isEditing={isEditing}
            type="date"
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange({ ...draftLead, entryDate: value })}
          />
          <div className="rounded-lg border border-border/80 bg-slate-950/40 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.09em] text-muted">Canal</p>
            <div className="mt-1.5">
              <ChannelBadge channel={lead.channel} />
            </div>
          </div>
        </div>
      </LeadSectionCard>

      <LeadSectionCard title="Status Comercial" subtitle="Panorama de maturidade e aderencia da oportunidade">
        <div className="grid gap-2 md:grid-cols-2">
          <LeadInlineField
            label="Status"
            value={draftLead.status}
            editable
            isEditing={isEditing}
            type="select"
            selectOptions={statusOptions}
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange({ ...draftLead, status: value as Lead["status"] })}
          />
          <LeadInlineField
            label="Momento de compra"
            value={commercial.buyingMoment}
            editable
            isEditing={isEditing}
            type="select"
            selectOptions={buyingMomentOptions}
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange(updateCommercialField(draftLead, "buyingMoment", value))}
          />
          <LeadInlineField
            label="Decisor identificado"
            value={commercial.decisionMakerIdentified}
            editable
            isEditing={isEditing}
            type="select"
            selectOptions={decisionOptions}
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange(updateCommercialField(draftLead, "decisionMakerIdentified", value))}
          />
          <LeadInlineField
            label="Fit ICP"
            value={commercial.icpFit}
            editable
            isEditing={isEditing}
            type="select"
            selectOptions={icpOptions}
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange(updateCommercialField(draftLead, "icpFit", value))}
          />
        </div>
      </LeadSectionCard>

      <LeadSectionCard title="Diagnostico" subtitle="Leitura rapida das dores e da necessidade do lead">
        <div className="grid gap-2 md:grid-cols-2">
          <LeadInlineField
            label="Problema principal"
            value={commercial.mainProblem}
            editable
            isEditing={isEditing}
            type="textarea"
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange(updateCommercialField(draftLead, "mainProblem", value))}
          />
          <LeadInlineField
            label="Dores"
            value={commercial.painPoints}
            editable
            isEditing={isEditing}
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange(updateCommercialField(draftLead, "painPoints", value))}
          />
          <LeadInlineField
            label="Interesse principal"
            value={commercial.mainInterest}
            editable={lead.channel === "inbound"}
            isEditing={isEditing}
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange(updateCommercialField(draftLead, "mainInterest", value))}
          />
        </div>
      </LeadSectionCard>

      <LeadSectionCard title="Acao" subtitle="Bloco operacional para guiar a proxima movimentacao comercial" highlight>
        <div className="grid gap-2 md:grid-cols-2">
          <LeadInlineField
            label="Proxima acao"
            value={draftLead.nextAction}
            editable
            isEditing={isEditing}
            type="textarea"
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange({ ...draftLead, nextAction: value })}
          />
          <LeadInlineField
            label="Data da proxima acao"
            value={draftLead.nextActionDate || ""}
            editable
            isEditing={isEditing}
            type="date"
            onActivateEdit={onActivateEdit}
            onChange={(value) => onDraftChange({ ...draftLead, nextActionDate: value })}
          />
          <LeadInlineField label="Ultima interacao" value={lead.lastInteraction} />
          <LeadInlineField label="Proxima acao sugerida" value="Sugerida por IA (em breve)" />
        </div>
      </LeadSectionCard>

      {hasFinancialData ? (
        <LeadSectionCard title="Financeiro" subtitle="Sinais de potencial e prioridade da conta">
          <div className="grid gap-2 md:grid-cols-2">
            <LeadInlineField
              label="Faturamento mensal"
              value={commercial.monthlyRevenueRange}
              editable
              isEditing={isEditing}
              type="select"
              selectOptions={revenueOptions}
              onActivateEdit={onActivateEdit}
              onChange={(value) => onDraftChange(updateCommercialField(draftLead, "monthlyRevenueRange", value))}
            />
            <LeadInlineField
              label="Volume de leads"
              value={commercial.averageLeadsPerMonth}
              editable
              isEditing={isEditing}
              onActivateEdit={onActivateEdit}
              onChange={(value) => onDraftChange(updateCommercialField(draftLead, "averageLeadsPerMonth", value))}
            />
          </div>
        </LeadSectionCard>
      ) : null}
    </div>
  );
}

import { Lead } from "@/types/crm";
import {
  getLeadQualificacaoNegocioForm,
  updateLeadQualificacaoNegocio,
  validateQualificacaoNegocio,
  type QualificacaoNegocioForm,
} from "./lead-detail-shared";
import { LeadSectionCard } from "./lead-section-card";

type LeadIntelligenceTabProps = {
  draftLead: Lead;
  isEditing: boolean;
  onActivateEdit: () => void;
  onEditingStateChange?: (editing: boolean) => void;
  onDraftChange: (next: Lead) => void;
  onPersist: (next: Lead) => void;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeIntegerFromInput(value: string): number | null {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function toDisplayInteger(value: number | null): string {
  if (!value || value <= 0) return "";
  return String(Math.floor(value));
}

function applyAndPersist(
  lead: Lead,
  patch: Partial<QualificacaoNegocioForm>,
  onDraftChange: (next: Lead) => void,
  onPersist: (next: Lead) => void,
) {
  const nextLead = updateLeadQualificacaoNegocio(lead, patch);
  onDraftChange(nextLead);
  onPersist(nextLead);
}

export function LeadIntelligenceTab({
  draftLead,
  onActivateEdit,
  onEditingStateChange,
  onDraftChange,
  onPersist,
}: LeadIntelligenceTabProps) {
  if (draftLead.channel !== "outbound" || !draftLead.outboundQualification) {
    return (
      <div className="space-y-4">
        <LeadSectionCard
          title="Qualificacao de negocio"
          subtitle="Disponivel para leads outbound com preenchimento comercial."
        >
          <p className="text-sm text-slate-300">
            Este lead nao possui estrutura outbound de qualificacao de negocio.
          </p>
        </LeadSectionCard>
      </div>
    );
  }

  const form = getLeadQualificacaoNegocioForm(draftLead);
  const validation = validateQualificacaoNegocio(form);

  return (
    <div className="space-y-4">
      <LeadSectionCard
        title="Qualificacao de negocio"
        subtitle="Preencha as informacoes comerciais para qualificar o lead."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Ja utiliza CRM? <span className="text-rose-300">*</span>
            <select
              className="field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
              value={form.jaUtilizaCrm || ""}
              onFocus={() => {
                onActivateEdit();
                onEditingStateChange?.(true);
              }}
              onBlur={() => onEditingStateChange?.(false)}
              onChange={(event) => {
                const value = event.target.value === "sim" ? "sim" : event.target.value === "nao" ? "nao" : null;
                applyAndPersist(draftLead, { jaUtilizaCrm: value }, onDraftChange, onPersist);
              }}
            >
              <option value="">Selecione...</option>
              <option value="sim">Sim</option>
              <option value="nao">Nao</option>
            </select>
          </label>

          {form.jaUtilizaCrm === "sim" ? (
            <>
              <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                Qual CRM utiliza? <span className="text-rose-300">*</span>
                <input
                  className="field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
                  value={form.qualCrmUtiliza}
                  onFocus={() => {
                    onActivateEdit();
                    onEditingStateChange?.(true);
                  }}
                  onBlur={() => onEditingStateChange?.(false)}
                  onChange={(event) =>
                    applyAndPersist(
                      draftLead,
                      {
                        qualCrmUtiliza: event.target.value,
                      },
                      onDraftChange,
                      onPersist,
                    )
                  }
                />
              </label>

              <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                Quanto paga? <span className="text-rose-300">*</span>
                <input
                  className="field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
                  value={form.quantoPagaCrm}
                  placeholder="Ex.: R$ 499,00"
                  onFocus={() => {
                    onActivateEdit();
                    onEditingStateChange?.(true);
                  }}
                  onBlur={() => onEditingStateChange?.(false)}
                  onChange={(event) =>
                    applyAndPersist(
                      draftLead,
                      {
                        quantoPagaCrm: event.target.value,
                      },
                      onDraftChange,
                      onPersist,
                    )
                  }
                />
              </label>
            </>
          ) : null}

          <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Faz trafego pago? <span className="text-rose-300">*</span>
            <select
              className="field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
              value={form.fazTrafegoPago || ""}
              onFocus={() => {
                onActivateEdit();
                onEditingStateChange?.(true);
              }}
              onBlur={() => onEditingStateChange?.(false)}
              onChange={(event) => {
                const value = event.target.value === "sim" ? "sim" : event.target.value === "nao" ? "nao" : null;
                applyAndPersist(draftLead, { fazTrafegoPago: value }, onDraftChange, onPersist);
              }}
            >
              <option value="">Selecione...</option>
              <option value="sim">Sim</option>
              <option value="nao">Nao</option>
            </select>
          </label>

          <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Quantos profissionais existem na clinica? <span className="text-rose-300">*</span>
            <input
              className="field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
              inputMode="numeric"
              value={toDisplayInteger(form.quantidadeProfissionaisClinica)}
              onFocus={() => {
                onActivateEdit();
                onEditingStateChange?.(true);
              }}
              onBlur={() => onEditingStateChange?.(false)}
              onChange={(event) => {
                const nextNumber = normalizeIntegerFromInput(event.target.value);
                applyAndPersist(
                  draftLead,
                  {
                    quantidadeProfissionaisClinica: nextNumber,
                  },
                  onDraftChange,
                  onPersist,
                );
              }}
            />
          </label>

          <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Qual o nome do decisor? <span className="text-rose-300">*</span>
            <input
              className="field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
              value={form.nomeDecisor}
              onFocus={() => {
                onActivateEdit();
                onEditingStateChange?.(true);
              }}
              onBlur={() => onEditingStateChange?.(false)}
              onChange={(event) =>
                applyAndPersist(
                  draftLead,
                  {
                    nomeDecisor: event.target.value,
                  },
                  onDraftChange,
                  onPersist,
                )
              }
            />
          </label>
        </div>

        {!validation.valid ? (
          <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Campos obrigatorios pendentes: {validation.missingRequiredFields.map((field) => normalizeText(field)).join(", ")}.
          </div>
        ) : null}
      </LeadSectionCard>
    </div>
  );
}

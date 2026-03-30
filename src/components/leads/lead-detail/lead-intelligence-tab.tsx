import { useEffect, useState } from "react";
import { Lead } from "@/types/crm";
import {
  businessTypeOptions,
  getLeadCommercialData,
  revenueOptions,
  updateCommercialField,
} from "./lead-detail-shared";
import { LeadInlineField } from "./lead-inline-field";
import { LeadSectionCard } from "./lead-section-card";

type LeadIntelligenceTabProps = {
  draftLead: Lead;
  isEditing: boolean;
  onActivateEdit: () => void;
  onEditingStateChange?: (editing: boolean) => void;
  onDraftChange: (next: Lead) => void;
  onPersist: (next: Lead) => void;
};

type IntelligenceEditableKey =
  | "businessType"
  | "specialty"
  | "monthlyRevenueRange"
  | "averageLeadsPerMonth"
  | "mainProblem"
  | "painPoints";

export function LeadIntelligenceTab({
  draftLead,
  isEditing,
  onActivateEdit,
  onEditingStateChange,
  onDraftChange,
  onPersist,
}: LeadIntelligenceTabProps) {
  const commercial = getLeadCommercialData(draftLead);
  const [activeField, setActiveField] = useState<IntelligenceEditableKey | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setActiveField(null);
    }
  }, [isEditing]);

  const openField = (field: IntelligenceEditableKey) => {
    const next = activeField === field ? null : field;
    setActiveField(next);
    onEditingStateChange?.(next !== null);
    if (next) onActivateEdit();
  };

  const closeField = () => {
    setActiveField(null);
    onEditingStateChange?.(false);
  };

  const applyUpdate = (field: string, value: string) => {
    const nextLead = updateCommercialField(draftLead, field, value);
    onDraftChange(nextLead);
    onPersist(nextLead);
  };

  return (
    <div className="space-y-4">
      <LeadSectionCard title="Negocio" subtitle="Caracteristicas da operacao e potencial da conta">
        <div className="grid gap-2 md:grid-cols-2">
          <LeadInlineField
            label="Tipo"
            value={commercial.businessType}
            editable
            isEditing={activeField === "businessType"}
            type="select"
            selectOptions={businessTypeOptions}
            deferCommit
            onActivateEdit={() => openField("businessType")}
            onChange={(value) => applyUpdate("businessType", value)}
            onFinishEdit={closeField}
            onCancelEdit={closeField}
          />
          <LeadInlineField
            label="Especialidade"
            value={commercial.specialty}
            editable
            isEditing={activeField === "specialty"}
            deferCommit
            onActivateEdit={() => openField("specialty")}
            onChange={(value) => applyUpdate("specialty", value)}
            onFinishEdit={closeField}
            onCancelEdit={closeField}
          />
          <LeadInlineField
            label="Faturamento mensal"
            value={commercial.monthlyRevenueRange}
            editable
            isEditing={activeField === "monthlyRevenueRange"}
            type="select"
            selectOptions={revenueOptions}
            deferCommit
            onActivateEdit={() => openField("monthlyRevenueRange")}
            onChange={(value) => applyUpdate("monthlyRevenueRange", value)}
            onFinishEdit={closeField}
            onCancelEdit={closeField}
          />
          <LeadInlineField
            label="Volume de leads"
            value={commercial.averageLeadsPerMonth}
            editable
            isEditing={activeField === "averageLeadsPerMonth"}
            deferCommit
            onActivateEdit={() => openField("averageLeadsPerMonth")}
            onChange={(value) => applyUpdate("averageLeadsPerMonth", value)}
            onFinishEdit={closeField}
            onCancelEdit={closeField}
          />
        </div>
      </LeadSectionCard>

      <LeadSectionCard title="Dor" subtitle="Principais bloqueios para avancar a venda">
        <div className="grid gap-2 md:grid-cols-2">
          <LeadInlineField
            label="Problema principal"
            value={commercial.mainProblem}
            editable
            isEditing={activeField === "mainProblem"}
            type="textarea"
            deferCommit
            onActivateEdit={() => openField("mainProblem")}
            onChange={(value) => applyUpdate("mainProblem", value)}
            onFinishEdit={closeField}
            onCancelEdit={closeField}
          />
          <LeadInlineField
            label="Dores"
            value={commercial.painPoints}
            editable
            isEditing={activeField === "painPoints"}
            deferCommit
            onActivateEdit={() => openField("painPoints")}
            onChange={(value) => applyUpdate("painPoints", value)}
            onFinishEdit={closeField}
            onCancelEdit={closeField}
          />
        </div>
      </LeadSectionCard>
    </div>
  );
}

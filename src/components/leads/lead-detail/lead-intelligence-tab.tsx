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
  onDraftChange: (next: Lead) => void;
  onPersist: (next: Lead) => void;
};

export function LeadIntelligenceTab({
  draftLead,
  isEditing,
  onActivateEdit,
  onDraftChange,
  onPersist,
}: LeadIntelligenceTabProps) {
  const commercial = getLeadCommercialData(draftLead);

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
            isEditing={isEditing}
            type="select"
            selectOptions={businessTypeOptions}
            onActivateEdit={onActivateEdit}
            onChange={(value) => applyUpdate("businessType", value)}
          />
          <LeadInlineField
            label="Especialidade"
            value={commercial.specialty}
            editable
            isEditing={isEditing}
            onActivateEdit={onActivateEdit}
            onChange={(value) => applyUpdate("specialty", value)}
          />
          <LeadInlineField
            label="Faturamento mensal"
            value={commercial.monthlyRevenueRange}
            editable
            isEditing={isEditing}
            type="select"
            selectOptions={revenueOptions}
            onActivateEdit={onActivateEdit}
            onChange={(value) => applyUpdate("monthlyRevenueRange", value)}
          />
          <LeadInlineField
            label="Volume de leads"
            value={commercial.averageLeadsPerMonth}
            editable
            isEditing={isEditing}
            onActivateEdit={onActivateEdit}
            onChange={(value) => applyUpdate("averageLeadsPerMonth", value)}
          />
        </div>
      </LeadSectionCard>

      <LeadSectionCard title="Dor" subtitle="Principais bloqueios para avancar a venda">
        <div className="grid gap-2 md:grid-cols-2">
          <LeadInlineField
            label="Problema principal"
            value={commercial.mainProblem}
            editable
            isEditing={isEditing}
            type="textarea"
            onActivateEdit={onActivateEdit}
            onChange={(value) => applyUpdate("mainProblem", value)}
          />
          <LeadInlineField
            label="Dores"
            value={commercial.painPoints}
            editable
            isEditing={isEditing}
            onActivateEdit={onActivateEdit}
            onChange={(value) => applyUpdate("painPoints", value)}
          />
        </div>
      </LeadSectionCard>
    </div>
  );
}

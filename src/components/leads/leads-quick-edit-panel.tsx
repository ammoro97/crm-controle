"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useResponsaveis } from "@/lib/responsaveis-store";
import { InteractionType, Lead, LeadStatus, PainPoint } from "@/types/crm";

export type QuickSaveMode = "save" | "save_and_interaction";

export type QuickInteractionPayload = {
  type: InteractionType;
  description: string;
  result: string;
};

type LeadsQuickEditPanelProps = {
  leads: Lead[];
  selectedLeadId: string;
  draftLead: Lead | null;
  onSelectLead: (leadId: string) => void;
  onDraftChange: (lead: Lead) => void;
  onSave: (mode: QuickSaveMode, payload?: QuickInteractionPayload, overrideLead?: Lead) => void;
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
const businessTypes = ["estetica", "odontologia"];
const revenueRanges = [
  "Ate R$ 50k/mensal",
  "R$ 50k a R$ 120k/mensal",
  "R$ 120k a R$ 180k/mensal",
  "R$ 180k a R$ 300k/mensal",
  "Acima de R$ 300k/mensal",
];
const buyingMoments = ["pesquisando", "avaliando", "quer resolver", "urgente"];
const inboundBuyingMoments = ["curioso", "avaliando", "quer resolver", "urgente"];
const inboundSourceChannels = ["Instagram", "Google Ads", "Indicacao", "WhatsApp", "Site"];
const inboundInterests = [
  "organizar agenda",
  "automatizar atendimento",
  "aumentar conversao",
  "melhorar follow-up",
];
const inboundNextActions = ["responder WhatsApp", "enviar apresentacao", "agendar call", "follow-up"];
const sourceChannels = [
  "Lista fria",
  "Instagram/Meta Ads",
  "Google Ads",
  "Indicacao",
  "LinkedIn",
  "Evento",
  "Outro",
];
const lossReasons = [
  "Sem budget",
  "Sem urgencia",
  "Escolheu concorrente",
  "Nao era decisor",
  "Sem fit",
  "Sem resposta",
  "Outro",
];
const painOptions: PainPoint[] = [
  "perde leads",
  "demora no atendimento",
  "agenda baguncada",
  "sem acompanhamento",
  "equipe desorganizada",
];

function updateOutboundField<K extends keyof NonNullable<Lead["outboundQualification"]>>(
  lead: Lead,
  key: K,
  value: NonNullable<Lead["outboundQualification"]>[K] | string,
): Lead {
  if (!lead.outboundQualification) return lead;
  return {
    ...lead,
    outboundQualification: {
      ...lead.outboundQualification,
      [key]: value,
    },
  };
}

function updateInboundField<K extends keyof NonNullable<Lead["inboundQualification"]>>(
  lead: Lead,
  key: K,
  value: NonNullable<Lead["inboundQualification"]>[K] | string,
): Lead {
  if (!lead.inboundQualification) return lead;
  return {
    ...lead,
    inboundQualification: {
      ...lead.inboundQualification,
      [key]: value,
    },
  };
}

function togglePainPoint(pains: PainPoint[], pain: PainPoint): PainPoint[] {
  if (pains.includes(pain)) return pains.filter((item) => item !== pain);
  return [...pains, pain];
}

function nextActionOptions(decisionMaker: "sim" | "nao"): string[] {
  if (decisionMaker === "nao") {
    return ["ligar novamente", "tentar outro horario", "pedir contato do decisor", "falar com recepcao", "pesquisar online"];
  }
  return ["enviar WhatsApp", "agendar reuniao", "enviar proposta", "follow-up", "negociacao"];
}

export function LeadsQuickEditPanel({
  leads,
  selectedLeadId,
  draftLead,
  onSelectLead,
  onDraftChange,
  onSave,
}: LeadsQuickEditPanelProps) {
  const owners = useResponsaveis();
  const [interactionOpen, setInteractionOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [interactionDraft, setInteractionDraft] = useState<QuickInteractionPayload>({
    type: "ligacao",
    description: "",
    result: "",
  });

  const openInteraction = () => {
    setInteractionDraft({ type: "ligacao", description: "", result: "" });
    setInteractionOpen(true);
  };

  const leadWithNote = () => {
    if (!draftLead) return null;
    const note = newNote.trim();
    if (!note) return draftLead;
    return {
      ...draftLead,
      internalNotes: [...draftLead.internalNotes, note],
    };
  };

  const handleSave = (mode: QuickSaveMode, payload?: QuickInteractionPayload) => {
    const prepared = leadWithNote();
    if (!prepared) return;
    onSave(mode, payload, prepared);
    if (mode === "save_and_interaction") setNewNote("");
  };

  const confirmInteraction = () => {
    const note = newNote.trim();
    const description = note ? `${interactionDraft.description} | Observacao: ${note}` : interactionDraft.description;
    handleSave("save_and_interaction", { ...interactionDraft, description });
    setInteractionOpen(false);
  };

  return (
    <section className="panel mb-3 p-3 xl:p-3.5">
      <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        Selecionar lead
        <select
          className="field mt-1.5 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
          value={selectedLeadId}
          onChange={(event) => {
            setNewNote("");
            onSelectLead(event.target.value);
          }}
        >
          <option value="">Escolha um lead</option>
          {leads.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.name} - {lead.company}
            </option>
          ))}
        </select>
      </label>

      {draftLead ? (
        <div className="mt-2.5 space-y-2.5 rounded-xl border border-border bg-slate-900/40 p-2.5 xl:p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-100 xl:text-lg">{draftLead.name}</h3>
              <p className="text-xs text-muted xl:text-sm">{draftLead.company}</p>
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                draftLead.channel === "inbound"
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-300"
                  : "border-sky-400/40 bg-sky-500/20 text-sky-300"
              }`}
            >
              {draftLead.channel}
            </span>
          </div>

          {draftLead.channel === "outbound" && draftLead.outboundQualification ? (
            <div className="grid gap-2.5 xl:grid-cols-3 2xl:grid-cols-[1.15fr_1fr_1.15fr]">
              {(() => {
                const qualification = draftLead.outboundQualification;
                const removerDecisor = (index: number) => {
                  const novos = [...qualification.decisionContacts];
                  novos.splice(index, 1);
                  onDraftChange(updateOutboundField(draftLead, "decisionContacts", novos));
                };
                return (
                  <>
                    <section className="space-y-1.5 rounded-lg border border-border bg-slate-900/40 p-2.5">
                      <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Decisao</h4>
                      <SelectField
                        label="Decisor identificado?"
                        value={qualification.decisionMakerIdentified}
                        options={["sim", "nao"]}
                        onChange={(value) => onDraftChange(updateOutboundField(draftLead, "decisionMakerIdentified", value))}
                      />
                      {qualification.decisionMakerIdentified === "sim" ? (
                        <div className="space-y-1.5">
                          {qualification.decisionContacts.map((contact, index) => (
                            <div key={index} className="grid gap-1.5 rounded-md border border-border p-2">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                                  Decisor {index + 1}
                                </p>
                                {index > 0 ? (
                                  <button
                                    type="button"
                                    className="rounded px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-800"
                                    onClick={() => removerDecisor(index)}
                                  >
                                    Remover
                                  </button>
                                ) : null}
                              </div>
                              <InputField
                                label="Nome do decisor"
                                value={contact.name}
                                onChange={(value) => {
                                  const next = [...qualification.decisionContacts];
                                  next[index] = { ...next[index], name: value };
                                  onDraftChange(updateOutboundField(draftLead, "decisionContacts", next));
                                }}
                              />
                              <InputField
                                label="Telefone"
                                value={contact.phone}
                                onChange={(value) => {
                                  const next = [...qualification.decisionContacts];
                                  next[index] = { ...next[index], phone: value };
                                  onDraftChange(updateOutboundField(draftLead, "decisionContacts", next));
                                }}
                              />
                              <InputField
                                label="Email"
                                value={contact.email}
                                onChange={(value) => {
                                  const next = [...qualification.decisionContacts];
                                  next[index] = { ...next[index], email: value };
                                  onDraftChange(updateOutboundField(draftLead, "decisionContacts", next));
                                }}
                              />
                            </div>
                          ))}
                          <button
                            type="button"
                            className="btn-ghost h-8 px-2.5 py-1 text-xs"
                            onClick={() =>
                              onDraftChange(
                                updateOutboundField(draftLead, "decisionContacts", [
                                  ...qualification.decisionContacts,
                                  { name: "", phone: "", email: "" },
                                ]),
                              )
                            }
                          >
                            + adicionar decisor
                          </button>
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          <InputField
                            label="Quem atendeu?"
                            value={qualification.whoAnswered}
                            onChange={(value) => onDraftChange(updateOutboundField(draftLead, "whoAnswered", value))}
                          />
                          <SelectField
                            label="Numero de tentativas"
                            value={qualification.attemptCount}
                            options={["1", "2", "3", "4+"]}
                            onChange={(value) => onDraftChange(updateOutboundField(draftLead, "attemptCount", value))}
                          />
                        </div>
                      )}

                      <h4 className="pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        Sistema atual
                      </h4>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        <SelectField
                          label="Usa CRM?"
                          value={qualification.usesCrm}
                          options={["sim", "nao"]}
                          onChange={(value) => onDraftChange(updateOutboundField(draftLead, "usesCrm", value))}
                        />
                        {qualification.usesCrm === "sim" ? (
                          <InputField
                            label="Qual CRM?"
                            value={qualification.crmName}
                            onChange={(value) => onDraftChange(updateOutboundField(draftLead, "crmName", value))}
                          />
                        ) : null}
                        <SelectField
                          label="Usa agenda digital?"
                          value={qualification.usesDigitalSchedule}
                          options={["sim", "nao"]}
                          onChange={(value) => onDraftChange(updateOutboundField(draftLead, "usesDigitalSchedule", value))}
                        />
                        <SelectField
                          label="Usa planilha?"
                          value={qualification.usesSpreadsheet}
                          options={["sim", "nao"]}
                          onChange={(value) => onDraftChange(updateOutboundField(draftLead, "usesSpreadsheet", value))}
                        />
                        <SelectField
                          label="Nao usa nada?"
                          value={qualification.usesNothing}
                          options={["sim", "nao"]}
                          onChange={(value) => onDraftChange(updateOutboundField(draftLead, "usesNothing", value))}
                        />
                      </div>
                    </section>

                    <section className="space-y-1.5 rounded-lg border border-border bg-slate-900/40 p-2.5">
                      <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Dor</h4>
                      <div className="grid gap-0.5">
                        {painOptions.map((pain) => (
                          <label key={pain} className="flex items-center gap-2 text-[11px] text-slate-200">
                            <input
                              type="checkbox"
                              checked={qualification.painPoints.includes(pain)}
                              onChange={() =>
                                onDraftChange(
                                  updateOutboundField(
                                    draftLead,
                                    "painPoints",
                                    togglePainPoint(qualification.painPoints, pain),
                                  ),
                                )
                              }
                            />
                            {pain}
                          </label>
                        ))}
                      </div>
                      <TextareaField
                        label="Problema principal"
                        value={qualification.mainProblem}
                        onChange={(value) => onDraftChange(updateOutboundField(draftLead, "mainProblem", value))}
                        className="min-h-28 xl:min-h-32"
                      />
                    </section>

                    <section className="space-y-1.5 rounded-lg border border-border bg-slate-900/40 p-2.5">
                      <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Negocio</h4>
                      <SelectField
                        label="Tipo"
                        value={qualification.businessType}
                        options={businessTypes}
                        onChange={(value) => onDraftChange(updateOutboundField(draftLead, "businessType", value))}
                      />
                      <InputField
                        label="Especialidade"
                        value={qualification.specialty}
                        onChange={(value) => onDraftChange(updateOutboundField(draftLead, "specialty", value))}
                      />
                      <SelectField
                        label="Faturamento mensal"
                        value={qualification.monthlyRevenueRange}
                        options={revenueRanges}
                        onChange={(value) => onDraftChange(updateOutboundField(draftLead, "monthlyRevenueRange", value))}
                      />
                      <InputField
                        label="Volume de leads por mes"
                        value={qualification.averageLeadsPerMonth}
                        onChange={(value) => onDraftChange(updateOutboundField(draftLead, "averageLeadsPerMonth", value))}
                      />
                      <SelectField
                        label="Numero de funcionarios"
                        value={qualification.employeeCountRange}
                        options={["1-5", "6-15", "16-30", "30+"]}
                        onChange={(value) => onDraftChange(updateOutboundField(draftLead, "employeeCountRange", value))}
                      />
                      <SelectField
                        label="Numero de unidades"
                        value={qualification.unitCount}
                        options={["1", "2", "3", "4+"]}
                        onChange={(value) => onDraftChange(updateOutboundField(draftLead, "unitCount", value))}
                      />
                      <SelectField
                        label="Canal de origem"
                        value={draftLead.source}
                        options={sourceChannels}
                        onChange={(value) => onDraftChange({ ...draftLead, source: value })}
                      />
                      <SelectField
                        label="Status"
                        value={draftLead.status}
                        options={statusOptions}
                        onChange={(value) => onDraftChange({ ...draftLead, status: value as LeadStatus })}
                      />
                      {draftLead.status === "Perdido" ? (
                        <SelectField
                          label="Motivo de perda"
                          value={draftLead.lossReason || ""}
                          options={lossReasons}
                          onChange={(value) => onDraftChange({ ...draftLead, lossReason: value })}
                        />
                      ) : null}
                      <SelectField
                        label="Responsavel"
                        value={draftLead.owner}
                        options={owners}
                        onChange={(value) => onDraftChange({ ...draftLead, owner: value })}
                      />
                    </section>
                  </>
                );
              })()}
            </div>
          ) : null}

          {draftLead.channel === "inbound" && draftLead.inboundQualification ? (
            <div className="grid gap-2.5 xl:grid-cols-3 2xl:grid-cols-[1.05fr_1fr_1.05fr]">
              {(() => {
                const qualification = draftLead.inboundQualification;
                return (
                  <>
                    <section className="space-y-1.5 rounded-lg border border-border bg-slate-900/40 p-2.5">
                      <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Origem</h4>
                      <SelectField
                        label="Canal"
                        value={draftLead.source}
                        options={inboundSourceChannels}
                        onChange={(value) => onDraftChange({ ...draftLead, source: value })}
                      />
                      <InputField
                        label="Campanha (opcional)"
                        value={qualification.campaign}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "campaign", value))}
                      />
                      <h4 className="pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Intencao</h4>
                      <SelectField
                        label="Interesse principal"
                        value={qualification.mainInterest}
                        options={inboundInterests}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "mainInterest", value))}
                      />
                      <TextareaField
                        label="Mensagem inicial"
                        value={qualification.initialMessage}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "initialMessage", value))}
                        className="min-h-24 xl:min-h-28"
                      />
                      <h4 className="pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Negocio</h4>
                      <SelectField
                        label="Tipo"
                        value={qualification.businessType}
                        options={businessTypes}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "businessType", value))}
                      />
                      <InputField
                        label="Especialidade"
                        value={qualification.specialty}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "specialty", value))}
                      />
                      <SelectField
                        label="Faturamento mensal"
                        value={qualification.monthlyRevenueRange}
                        options={revenueRanges}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "monthlyRevenueRange", value))}
                      />
                      <InputField
                        label="Volume de leads por mes"
                        value={qualification.averageLeadsPerMonth}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "averageLeadsPerMonth", value))}
                      />
                    </section>

                    <section className="space-y-1.5 rounded-lg border border-border bg-slate-900/40 p-2.5">
                      <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Dor</h4>
                      <div className="grid gap-0.5">
                        {painOptions.map((pain) => (
                          <label key={pain} className="flex items-center gap-2 text-[11px] text-slate-200">
                            <input
                              type="checkbox"
                              checked={qualification.painPoints.includes(pain)}
                              onChange={() =>
                                onDraftChange(
                                  updateInboundField(
                                    draftLead,
                                    "painPoints",
                                    togglePainPoint(qualification.painPoints, pain),
                                  ),
                                )
                              }
                            />
                            {pain}
                          </label>
                        ))}
                      </div>
                      <TextareaField
                        label="Problema principal"
                        value={qualification.mainProblem}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "mainProblem", value))}
                        className="min-h-32 xl:min-h-36"
                      />
                    </section>

                    <section className="space-y-1.5 rounded-lg border border-border bg-slate-900/40 p-2.5">
                      <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Qualificacao</h4>
                      <SelectField
                        label="Decisor identificado"
                        value={qualification.decisionMakerIdentified}
                        options={["sim", "nao"]}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "decisionMakerIdentified", value))}
                      />
                      <SelectField
                        label="Momento de compra"
                        value={qualification.buyingMoment}
                        options={inboundBuyingMoments}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "buyingMoment", value))}
                      />
                      <SelectField
                        label="Fit ICP"
                        value={qualification.icpFit}
                        options={["baixo", "medio", "alto"]}
                        onChange={(value) => onDraftChange(updateInboundField(draftLead, "icpFit", value))}
                      />
                      <h4 className="pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Acao</h4>
                      <SelectField
                        label="Proxima acao"
                        value={draftLead.nextAction}
                        options={inboundNextActions}
                        onChange={(value) => onDraftChange({ ...draftLead, nextAction: value })}
                      />
                      <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                        Data da proxima acao
                        <input
                          className="field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
                          type="date"
                          value={draftLead.nextActionDate || ""}
                          onChange={(event) => onDraftChange({ ...draftLead, nextActionDate: event.target.value })}
                        />
                      </label>
                      <h4 className="pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Gestao</h4>
                      <SelectField
                        label="Responsavel"
                        value={draftLead.owner}
                        options={owners}
                        onChange={(value) => onDraftChange({ ...draftLead, owner: value })}
                      />
                      <SelectField
                        label="Status"
                        value={draftLead.status}
                        options={statusOptions}
                        onChange={(value) => onDraftChange({ ...draftLead, status: value as LeadStatus })}
                      />
                      {draftLead.status === "Perdido" ? (
                        <SelectField
                          label="Motivo de perda"
                          value={draftLead.lossReason || ""}
                          options={lossReasons}
                          onChange={(value) => onDraftChange({ ...draftLead, lossReason: value })}
                        />
                      ) : null}
                    </section>
                  </>
                );
              })()}
            </div>
          ) : null}

          {draftLead.channel === "outbound" ? (
            <div className="grid gap-2 xl:grid-cols-[1.3fr_1fr]">
              <SelectField
                label="Proxima acao"
                value={draftLead.nextAction}
                options={
                  draftLead.outboundQualification
                    ? nextActionOptions(draftLead.outboundQualification.decisionMakerIdentified)
                    : ["enviar WhatsApp", "agendar reuniao", "enviar proposta", "follow-up", "negociacao"]
                }
                onChange={(value) => onDraftChange({ ...draftLead, nextAction: value })}
              />
              <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                Data da proxima acao
                <input
                  className="field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
                  type="date"
                  value={draftLead.nextActionDate || ""}
                  onChange={(event) => onDraftChange({ ...draftLead, nextActionDate: event.target.value })}
                />
              </label>
            </div>
          ) : null}

          <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Observacoes (nova entrada)
            <textarea
              className="field mt-1 min-h-[84px] px-2.5 py-1.5 text-xs xl:min-h-24 xl:text-[13px]"
              value={newNote}
              onChange={(event) => setNewNote(event.target.value)}
              placeholder=""
            />
          </label>

          <section className="space-y-1.5 rounded-lg border border-border bg-slate-900/40 p-2.5">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Historico</h4>
            <div className="h-[150px] space-y-1 overflow-y-auto rounded-lg border border-border bg-slate-950/50 p-2">
              {draftLead.history.filter((event) => event.eventType.startsWith("interacao")).length === 0 ? (
                <p className="text-[11px] text-muted">Sem interacoes registradas.</p>
              ) : (
                draftLead.history
                  .filter((event) => event.eventType.startsWith("interacao"))
                  .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
                  .map((event) => (
                    <article key={event.id} className="rounded-md border border-border bg-slate-900/60 px-2 py-1">
                      <p className="text-[10px] text-muted">
                        {new Date(`${event.date}T${event.time}`).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-[11px] text-slate-200">{event.description}</p>
                    </article>
                  ))
              )}
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost h-9 px-3 py-1.5 text-xs" onClick={() => handleSave("save")}>
              Salvar alteracoes
            </button>
            <button type="button" className="btn-primary h-9 px-3 py-1.5 text-xs" onClick={openInteraction}>
              Salvar e registrar interacao
            </button>
          </div>
        </div>
      ) : null}

      <Modal title="Registrar Interacao" open={interactionOpen} onClose={() => setInteractionOpen(false)}>
        <div className="space-y-3">
          <SelectField
            label="Tipo"
            value={interactionDraft.type}
            options={["ligacao", "whatsapp", "reuniao", "email"]}
            onChange={(value) => setInteractionDraft((prev) => ({ ...prev, type: value as InteractionType }))}
          />
          <TextareaField
            label="Descricao"
            value={interactionDraft.description}
            onChange={(value) => setInteractionDraft((prev) => ({ ...prev, description: value }))}
          />
          <TextareaField
            label="Resultado"
            value={interactionDraft.result}
            onChange={(value) => setInteractionDraft((prev) => ({ ...prev, result: value }))}
          />
          <button type="button" className="btn-primary" onClick={confirmInteraction}>
            Confirmar registro
          </button>
        </div>
      </Modal>
    </section>
  );
}

function InputField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
      {label}
      <input
        className={`field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px] ${className || ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
      {label}
      <textarea
        className={`field mt-1 min-h-[84px] px-2.5 py-1.5 text-xs xl:text-[13px] ${className || ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
      {label}
      <select
        className={`field mt-1 h-9 px-2.5 py-1.5 text-xs xl:text-[13px] ${className || ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

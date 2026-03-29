"use client";

import { useState } from "react";
import { useResponsaveis } from "@/lib/responsaveis-store";
import { Lead, LeadObservationType, PainPoint } from "@/types/crm";

type LeadDetailDrawerProps = {
  lead: Lead | null;
  open: boolean;
  onSave: (lead: Lead) => void;
  onClose: () => void;
};

type DetailTab = "resumo" | "historico" | "qualificacao" | "observacoes";

const tabs: { id: DetailTab; label: string }[] = [
  { id: "resumo", label: "Resumo" },
  { id: "historico", label: "Historico" },
  { id: "qualificacao", label: "Qualificacao" },
  { id: "observacoes", label: "Observacoes" },
];

function ChannelBadge({ channel }: { channel: Lead["channel"] }) {
  const style =
    channel === "inbound"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40"
      : "bg-sky-500/20 text-sky-300 border-sky-400/40";

  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold uppercase ${style}`}>{channel}</span>;
}

type SummaryTabProps = {
  lead: Lead;
  draftLead: Lead;
  isEditing: boolean;
  onActivateEdit: () => void;
  onDraftChange: (next: Lead) => void;
};

function SummaryTab({ lead, draftLead, isEditing, onActivateEdit, onDraftChange }: SummaryTabProps) {
  const statusOptions: Lead["status"][] = [
    "Novo",
    "Contato iniciado",
    "Qualificado",
    "Reuniao marcada",
    "Proposta enviada",
    "Perdido",
    "Fechado",
  ];
  const ownerOptions = useResponsaveis();

  const items = [
    { label: "Nome", key: "name", type: "input" as const, editable: true, value: draftLead.name },
    { label: "Empresa/Clinica", key: "company", type: "input" as const, editable: true, value: draftLead.company },
    { label: "Telefone", key: "phone", type: "input" as const, editable: true, value: draftLead.phone },
    { label: "Email", key: "email", type: "input" as const, editable: true, value: draftLead.email },
    { label: "Cidade", key: "city", type: "input" as const, editable: false, value: lead.city },
    { label: "Nicho", key: "niche", type: "input" as const, editable: false, value: lead.niche },
    { label: "Origem", key: "source", type: "input" as const, editable: false, value: lead.source },
    { label: "Canal", key: "channel", type: "input" as const, editable: false, value: lead.channel },
    { label: "Status", key: "status", type: "select" as const, editable: true, value: draftLead.status },
    { label: "Responsavel", key: "owner", type: "select" as const, editable: true, value: draftLead.owner },
    { label: "Data de entrada", key: "entryDate", type: "input" as const, editable: false, value: lead.entryDate },
    {
      label: "Ultima interacao",
      key: "lastInteraction",
      type: "input" as const,
      editable: false,
      value: lead.lastInteraction,
    },
    { label: "Proxima acao", key: "nextAction", type: "textarea" as const, editable: true, value: draftLead.nextAction },
    {
      label: "Data da proxima acao",
      key: "nextActionDate",
      type: "date" as const,
      editable: true,
      value: draftLead.nextActionDate || "",
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className={`rounded-lg border border-border bg-slate-900/50 p-3 ${item.editable ? "cursor-pointer" : ""}`}
          onClick={() => {
            if (item.editable && !isEditing) onActivateEdit();
          }}
        >
          <p className="text-xs uppercase tracking-wide text-muted">
            {item.label}
            {item.editable && !isEditing ? <span className="ml-2 text-[10px] text-slate-400">(clique para editar)</span> : null}
          </p>
          {item.editable && isEditing ? (
            item.type === "textarea" ? (
              <textarea
                className="field mt-1 min-h-16"
                value={item.value}
                onChange={(event) => onDraftChange({ ...draftLead, [item.key]: event.target.value })}
              />
            ) : item.type === "select" ? (
              <select
                className="field mt-1"
                value={item.value}
                onChange={(event) => onDraftChange({ ...draftLead, [item.key]: event.target.value })}
              >
                {(item.key === "status" ? statusOptions : ownerOptions).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : item.type === "date" ? (
              <input
                className="field mt-1"
                type="date"
                value={item.value}
                onChange={(event) => onDraftChange({ ...draftLead, [item.key]: event.target.value })}
              />
            ) : (
              <input
                className="field mt-1"
                value={item.value}
                onChange={(event) => onDraftChange({ ...draftLead, [item.key]: event.target.value })}
              />
            )
          ) : (
            <p className="mt-1 text-sm text-slate-100">{item.value || "-"}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ lead, onOpenObservacoes }: { lead: Lead; onOpenObservacoes: () => void }) {
  return (
    <div className="relative space-y-4 pl-5 before:absolute before:left-2 before:top-0 before:h-full before:w-px before:bg-border">
      {lead.history.map((event) => (
        <article
          key={event.id}
          className={`relative rounded-lg border border-border bg-slate-900/50 p-3 ${
            event.linkedTab === "observacoes" || event.linkedObservationId ? "cursor-pointer transition hover:bg-slate-900/70" : ""
          }`}
          onClick={() => {
            if (event.linkedTab === "observacoes" || event.linkedObservationId) {
              onOpenObservacoes();
            }
          }}
        >
          <span className="absolute -left-5 top-4 h-2.5 w-2.5 rounded-full bg-accent" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {event.date} - {event.time}
            </p>
            <span className="rounded bg-slate-800 px-2 py-1 text-xs uppercase tracking-wide text-slate-300">
              {event.eventType}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-100">{event.description}</p>
          <p className="mt-2 text-xs text-muted">Responsavel: {event.owner}</p>
          {event.linkedTab === "observacoes" || event.linkedObservationId ? (
            <p className="mt-2 text-[11px] text-emerald-300">Clique para abrir Observacoes</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

type QualificationTabProps = {
  lead: Lead;
  draftLead: Lead;
  onDraftChange: (next: Lead) => void;
  onPersist: (next: Lead) => void;
};

function QualificationTab({ lead, draftLead, onDraftChange, onPersist }: QualificationTabProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const sourceOptions = ["Instagram", "Google Ads", "Indicacao", "WhatsApp", "Site", "LinkedIn", "Evento", "Outro"];
  const businessTypeOptions = ["estetica", "odontologia"];
  const revenueOptions = [
    "Ate R$ 50k/mensal",
    "R$ 50k a R$ 120k/mensal",
    "R$ 120k a R$ 180k/mensal",
    "R$ 180k a R$ 300k/mensal",
    "Acima de R$ 300k/mensal",
  ];
  const decisionOptions = ["sim", "nao"];
  const buyingMomentOptions = ["curioso", "pesquisando", "avaliando", "quer resolver", "urgente"];
  const icpOptions = ["baixo", "medio", "alto"];

  const startEdit = (fieldId: string, value: string) => {
    setEditingField(fieldId);
    setEditingValue(value);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditingValue("");
  };

  const commitEdit = (overrideValue?: string) => {
    if (!editingField) return;
    const value = (overrideValue ?? editingValue).trim();
    let nextLead: Lead = { ...draftLead };

    if (lead.channel === "inbound" && nextLead.inboundQualification) {
      const inbound = { ...nextLead.inboundQualification };
      if (editingField === "source") nextLead.source = value;
      if (editingField === "in_campaign") inbound.campaign = value;
      if (editingField === "in_mainInterest") inbound.mainInterest = value as typeof inbound.mainInterest;
      if (editingField === "in_initialMessage") inbound.initialMessage = value;
      if (editingField === "in_businessType") inbound.businessType = value as typeof inbound.businessType;
      if (editingField === "in_specialty") inbound.specialty = value;
      if (editingField === "in_monthlyRevenueRange") inbound.monthlyRevenueRange = value;
      if (editingField === "in_averageLeadsPerMonth") inbound.averageLeadsPerMonth = value;
      if (editingField === "in_painPoints") {
        inbound.painPoints = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean) as PainPoint[];
      }
      if (editingField === "in_mainProblem") inbound.mainProblem = value;
      if (editingField === "in_decisionMakerIdentified") {
        inbound.decisionMakerIdentified = value as typeof inbound.decisionMakerIdentified;
      }
      if (editingField === "in_buyingMoment") inbound.buyingMoment = value as typeof inbound.buyingMoment;
      if (editingField === "in_icpFit") inbound.icpFit = value as typeof inbound.icpFit;
      nextLead = { ...nextLead, inboundQualification: inbound };
    }

    if (lead.channel === "outbound" && nextLead.outboundQualification) {
      const outbound = { ...nextLead.outboundQualification };
      if (editingField === "out_businessType") outbound.businessType = value as typeof outbound.businessType;
      if (editingField === "out_specialty") outbound.specialty = value;
      if (editingField === "out_monthlyRevenueRange") outbound.monthlyRevenueRange = value;
      if (editingField === "out_averageLeadsPerMonth") outbound.averageLeadsPerMonth = value;
      if (editingField === "out_painPoints") {
        outbound.painPoints = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean) as PainPoint[];
      }
      if (editingField === "out_mainProblem") outbound.mainProblem = value;
      if (editingField === "out_decisionMakerIdentified") {
        outbound.decisionMakerIdentified = value as typeof outbound.decisionMakerIdentified;
      }
      if (editingField === "out_buyingMoment") outbound.buyingMoment = value as typeof outbound.buyingMoment;
      if (editingField === "out_icpFit") outbound.icpFit = value as typeof outbound.icpFit;
      nextLead = { ...nextLead, outboundQualification: outbound };
    }

    onDraftChange(nextLead);
    onPersist(nextLead);
    cancelEdit();
  };

  const renderEditableField = ({
    id,
    label,
    value,
    type = "input",
    options = [],
  }: {
    id: string;
    label: string;
    value: string;
    type?: "input" | "textarea" | "select";
    options?: string[];
  }) => {
    const active = editingField === id;
    return (
      <div
        key={id}
        className={`rounded-lg border p-3 ${active ? "border-accent bg-slate-900/70" : "border-border bg-slate-900/50"} ${
          active ? "" : "cursor-pointer"
        }`}
        onClick={() => {
          if (!active) startEdit(id, value);
        }}
      >
        <p className="text-xs uppercase tracking-wide text-muted">
          {label}
          {!active ? <span className="ml-2 text-[10px] text-slate-400">(clique para editar)</span> : null}
        </p>
        {active ? (
          type === "textarea" ? (
            <textarea
              autoFocus
              className="field mt-1 min-h-20"
              value={editingValue}
              onChange={(event) => setEditingValue(event.target.value)}
              onBlur={() => commitEdit()}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancelEdit();
              }}
            />
          ) : type === "select" ? (
            <select
              autoFocus
              className="field mt-1"
              value={editingValue}
              onChange={(event) => {
                setEditingValue(event.target.value);
                commitEdit(event.target.value);
              }}
              onBlur={() => commitEdit()}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              className="field mt-1"
              value={editingValue}
              onChange={(event) => setEditingValue(event.target.value)}
              onBlur={() => commitEdit()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitEdit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEdit();
                }
              }}
            />
          )
        ) : (
          <p className="mt-1 text-sm text-slate-100">{value || "-"}</p>
        )}
      </div>
    );
  };

  if (lead.channel === "inbound" && draftLead.inboundQualification) {
    const inbound = draftLead.inboundQualification;
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {renderEditableField({ id: "source", label: "Canal", value: draftLead.source, type: "select", options: sourceOptions })}
        {renderEditableField({ id: "in_campaign", label: "Campanha", value: inbound.campaign || "-", type: "input" })}
        {renderEditableField({
          id: "in_mainInterest",
          label: "Interesse principal",
          value: inbound.mainInterest,
          type: "input",
        })}
        {renderEditableField({
          id: "in_initialMessage",
          label: "Mensagem inicial",
          value: inbound.initialMessage || "-",
          type: "textarea",
        })}
        {renderEditableField({
          id: "in_businessType",
          label: "Tipo",
          value: inbound.businessType,
          type: "select",
          options: businessTypeOptions,
        })}
        {renderEditableField({ id: "in_specialty", label: "Especialidade", value: inbound.specialty || "-" })}
        {renderEditableField({
          id: "in_monthlyRevenueRange",
          label: "Faturamento mensal",
          value: inbound.monthlyRevenueRange,
          type: "select",
          options: revenueOptions,
        })}
        {renderEditableField({
          id: "in_averageLeadsPerMonth",
          label: "Volume de leads por mes",
          value: inbound.averageLeadsPerMonth || "-",
        })}
        {renderEditableField({
          id: "in_painPoints",
          label: "Dores",
          value: inbound.painPoints.join(", "),
          type: "input",
        })}
        {renderEditableField({
          id: "in_mainProblem",
          label: "Problema principal",
          value: inbound.mainProblem || "-",
          type: "textarea",
        })}
        {renderEditableField({
          id: "in_decisionMakerIdentified",
          label: "Decisor identificado",
          value: inbound.decisionMakerIdentified,
          type: "select",
          options: decisionOptions,
        })}
        {renderEditableField({
          id: "in_buyingMoment",
          label: "Momento de compra",
          value: inbound.buyingMoment,
          type: "select",
          options: buyingMomentOptions,
        })}
        {renderEditableField({
          id: "in_icpFit",
          label: "Fit ICP",
          value: inbound.icpFit,
          type: "select",
          options: icpOptions,
        })}
      </div>
    );
  }

  if (lead.channel === "outbound" && draftLead.outboundQualification) {
    const outbound = draftLead.outboundQualification;
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {renderEditableField({
          id: "out_businessType",
          label: "Tipo",
          value: outbound.businessType,
          type: "select",
          options: businessTypeOptions,
        })}
        {renderEditableField({ id: "out_specialty", label: "Especialidade", value: outbound.specialty || "-" })}
        {renderEditableField({
          id: "out_monthlyRevenueRange",
          label: "Faturamento mensal",
          value: outbound.monthlyRevenueRange,
          type: "select",
          options: revenueOptions,
        })}
        {renderEditableField({
          id: "out_averageLeadsPerMonth",
          label: "Volume medio de leads por mes",
          value: outbound.averageLeadsPerMonth || "-",
        })}
        {renderEditableField({
          id: "out_painPoints",
          label: "Dores",
          value: outbound.painPoints.join(", "),
          type: "input",
        })}
        {renderEditableField({
          id: "out_mainProblem",
          label: "Problema principal",
          value: outbound.mainProblem || "-",
          type: "textarea",
        })}
        {renderEditableField({
          id: "out_decisionMakerIdentified",
          label: "Decisor identificado",
          value: outbound.decisionMakerIdentified,
          type: "select",
          options: decisionOptions,
        })}
        {renderEditableField({
          id: "out_buyingMoment",
          label: "Momento de compra",
          value: outbound.buyingMoment,
          type: "select",
          options: buyingMomentOptions,
        })}
        {renderEditableField({
          id: "out_icpFit",
          label: "Fit ICP",
          value: outbound.icpFit,
          type: "select",
          options: icpOptions,
        })}
      </div>
    );
  }

  return <p className="text-sm text-muted">Sem dados de qualificacao para este lead.</p>;
}

const observationTypes: LeadObservationType[] = ["contato", "follow-up", "objecao", "informacao interna", "negociacao"];

type NotesTabProps = {
  lead: Lead;
  draftLead: Lead;
  onDraftChange: (next: Lead) => void;
  onPersist: (next: Lead) => void;
};

function NotesTab({ lead, draftLead, onDraftChange, onPersist }: NotesTabProps) {
  const [noteType, setNoteType] = useState<LeadObservationType>("informacao interna");
  const [noteText, setNoteText] = useState("");

  const addObservation = () => {
    const content = noteText.trim();
    if (!content) return;

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const nextLead: Lead = {
      ...draftLead,
      internalNotes: [...draftLead.internalNotes, content],
      observationLog: [
        ...draftLead.observationLog,
        {
          id: `O-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date,
          time,
          owner: draftLead.owner || "Time Comercial",
          type: noteType,
          content,
        },
      ],
    };

    onDraftChange(nextLead);
    onPersist(nextLead);
    setNoteText("");
    setNoteType("informacao interna");
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-slate-900/50 p-3">
        <div className="grid gap-2 md:grid-cols-[180px_1fr]">
          <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
            Tipo da observacao
            <select className="field mt-1 h-9 px-2.5 py-1.5 text-xs" value={noteType} onChange={(e) => setNoteType(e.target.value as LeadObservationType)}>
              {observationTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
            Nova observacao
            <textarea
              className="field mt-1 min-h-24 px-2.5 py-1.5 text-xs"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Escreva um registro interno do lead"
            />
          </label>
        </div>
        <button type="button" className="btn-primary mt-3 h-9 px-3 py-1.5 text-xs" onClick={addObservation}>
          Adicionar observacao
        </button>
      </div>

      {lead.observationLog.length === 0 ? (
        <div className="rounded-lg border border-border bg-slate-900/50 p-3 text-sm text-muted">Nenhuma observacao registrada.</div>
      ) : (
        lead.observationLog
          .slice()
          .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
          .map((note) => (
            <article key={note.id} className="rounded-lg border border-border bg-slate-900/50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{note.date}</span>
                <span>{note.time}</span>
                <span className="rounded bg-slate-800 px-2 py-0.5 uppercase">{note.type}</span>
                <span>Responsavel: {note.owner || "-"}</span>
              </div>
              <p className="mt-2 text-sm text-slate-100">{note.content}</p>
            </article>
          ))
      )}
    </div>
  );
}

export function LeadDetailDrawer({ lead, open, onSave, onClose }: LeadDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("resumo");
  const [isEditing, setIsEditing] = useState(false);
  const [draftLead, setDraftLead] = useState<Lead | null>(lead);

  if (!open || !lead || !draftLead) return null;

  const tabContent =
    activeTab === "resumo" ? (
      <SummaryTab
        lead={lead}
        draftLead={draftLead}
        isEditing={isEditing}
        onActivateEdit={() => setIsEditing(true)}
        onDraftChange={setDraftLead}
      />
    ) : activeTab === "historico" ? (
      <HistoryTab
        lead={lead}
        onOpenObservacoes={() => {
          setActiveTab("observacoes");
        }}
      />
    ) : activeTab === "qualificacao" ? (
      <QualificationTab
        lead={lead}
        draftLead={draftLead}
        onDraftChange={setDraftLead}
        onPersist={(next) => onSave(next)}
      />
    ) : (
      <NotesTab
        lead={lead}
        draftLead={draftLead}
        onDraftChange={setDraftLead}
        onPersist={(next) => onSave(next)}
      />
    );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70">
      <button className="h-full flex-1" type="button" onClick={onClose} aria-label="Fechar detalhes do lead" />
      <aside className="h-full w-full max-w-3xl border-l border-border bg-bg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{lead.name}</h2>
            <p className="mt-1 text-sm text-muted">{lead.company}</p>
          </div>
          <div className="flex items-center gap-2">
            <ChannelBadge channel={lead.channel} />
            {isEditing ? (
              <>
                <button
                  className="btn-primary px-2 py-1"
                  type="button"
                  onClick={() => {
                    onSave(draftLead);
                    setIsEditing(false);
                  }}
                >
                  Salvar alteracoes
                </button>
                <button
                  className="btn-ghost px-2 py-1"
                  type="button"
                  onClick={() => {
                    setDraftLead(lead);
                    setIsEditing(false);
                  }}
                >
                  Cancelar
                </button>
              </>
            ) : null}
            <button className="btn-ghost px-2 py-1" type="button" onClick={onClose}>
              Fechar
            </button>
          </div>
        </div>

        <div className="border-b border-border px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  activeTab === tab.id ? "bg-slate-800 text-slate-100" : "text-muted hover:bg-slate-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[calc(100vh-140px)] overflow-y-auto px-5 py-4">{tabContent}</div>
      </aside>
    </div>
  );
}

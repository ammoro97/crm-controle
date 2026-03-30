"use client";

import { useEffect, useMemo, useState } from "react";
import { Lead, LeadObservationType } from "@/types/crm";
import { LeadGeneralTab } from "./lead-detail/lead-general-tab";
import { LeadIntelligenceTab } from "./lead-detail/lead-intelligence-tab";
import {
  ChannelBadge,
  normalizeEventTypeLabel,
  normalizeHistoryDescription,
  observationTypes,
} from "./lead-detail/lead-detail-shared";

type LeadDetailDrawerProps = {
  lead: Lead | null;
  open: boolean;
  onSave: (lead: Lead) => void;
  onClose: () => void;
};

type DetailTab = "resumo" | "historico" | "qualificacao" | "observacoes";

type TimelineItem = {
  id: string;
  date: string;
  time: string;
  eventType: string;
  description: string;
  owner: string;
  linkedObservationId?: string;
  sourceEventType: string;
};

const tabs: { id: DetailTab; label: string }[] = [
  { id: "resumo", label: "Resumo" },
  { id: "historico", label: "Historico" },
  { id: "qualificacao", label: "Qualificacao" },
  { id: "observacoes", label: "Observacoes" },
];

function LeadHistoryTab({
  draftLead,
  onOpenObservation,
}: {
  draftLead: Lead;
  onOpenObservation: (observationId: string) => void;
}) {
  const timelineItems = useMemo<TimelineItem[]>(() => {
    const historyItems = draftLead.history
      .filter((event) => {
        const type = String(event.eventType || "").trim().toUpperCase();
        return (
          type === "LEAD_CRIADO" ||
          type === "LEAD CRIADO" ||
          type === "LEAD IMPORTADO" ||
          type === "LIGACAO" ||
          type === "LIGACAO FINALIZADA" ||
          type === "LIGACAO REALIZADA" ||
          type === "AGENDAMENTO" ||
          type === "REUNIAO AGENDADA"
        );
      })
      .map((event) => ({
      id: `hist-${event.id}`,
      date: event.date,
      time: event.time,
      eventType: normalizeEventTypeLabel(event.eventType),
      description: normalizeHistoryDescription(event),
      owner: event.owner,
      linkedObservationId: event.linkedObservationId,
      sourceEventType: String(event.eventType || "").trim().toUpperCase(),
    }));

    return historyItems.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  }, [draftLead.history]);

  return (
    <div className="space-y-4">
      <div className="relative space-y-3 pl-5 before:absolute before:left-2 before:top-0 before:h-full before:w-px before:bg-border">
        {timelineItems.length === 0 ? (
          <div className="rounded-xl border border-border bg-slate-900/50 p-4 text-sm text-muted">Nenhum evento registrado.</div>
        ) : (
          timelineItems.map((item) => (
            <article
              key={item.id}
              className={`relative rounded-xl border p-4 ${
                item.sourceEventType.includes("LIGACAO") && item.linkedObservationId
                  ? "cursor-pointer border-emerald-400/40 bg-slate-900/60 transition hover:bg-slate-900/80"
                  : "border-border bg-slate-900/50"
              }`}
              onClick={() => {
                if (item.sourceEventType.includes("LIGACAO") && item.linkedObservationId) {
                  onOpenObservation(item.linkedObservationId);
                }
              }}
            >
              <span className="absolute -left-5 top-5 h-2.5 w-2.5 rounded-full bg-accent" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  {item.date} - {item.time}
                </p>
                <span className="rounded bg-slate-800 px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-slate-300">
                  {item.eventType}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-100">{item.description}</p>
              <p className="mt-2 text-xs text-muted">Responsavel: {item.owner || "-"}</p>
              {item.sourceEventType.includes("LIGACAO") && item.linkedObservationId ? (
                <p className="mt-2 text-[11px] text-emerald-300">Clique para abrir a observacao vinculada</p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}

type LeadObservationsTabProps = {
  draftLead: Lead;
  onDraftChange: (next: Lead) => void;
  onPersist: (next: Lead) => void;
  targetObservationId?: string | null;
};

function LeadObservationsTab({ draftLead, onDraftChange, onPersist, targetObservationId }: LeadObservationsTabProps) {
  const [noteType, setNoteType] = useState<LeadObservationType>("informacao interna");
  const [noteText, setNoteText] = useState("");
  const [highlightedObservationId, setHighlightedObservationId] = useState<string | null>(null);

  useEffect(() => {
    if (!targetObservationId) return;
    setHighlightedObservationId(targetObservationId);
  }, [targetObservationId]);

  useEffect(() => {
    if (!highlightedObservationId) return;
    const element = document.getElementById(`lead-observation-${highlightedObservationId}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const clearId = window.setTimeout(() => setHighlightedObservationId(null), 1800);
    return () => window.clearTimeout(clearId);
  }, [highlightedObservationId]);

  const visibleObservations = useMemo(
    () =>
      draftLead.observationLog
        .filter((item) => {
          const content = String(item.content || "").trim();
          if (!content) return false;

          const lower = content.toLowerCase();
          if (lower.includes("finalizacao:")) return false;
          if (lower.includes("proxima acao:")) return false;
          if (lower.includes("follow-up:")) return false;
          if (lower.includes("duracao:")) return false;
          if (lower.includes("data/hora da ligacao:")) return false;
          if (lower.includes("motivo:")) return false;
          return true;
        })
        .slice()
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)),
    [draftLead.observationLog],
  );

  const addObservation = () => {
    const content = noteText.trim();
    if (!content) return;

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const owner = draftLead.owner || "Time Comercial";

    const nextLead: Lead = {
      ...draftLead,
      internalNotes: [...draftLead.internalNotes, content],
      observationLog: [
        ...draftLead.observationLog,
        {
          id: `O-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date,
          time,
          owner,
          type: noteType,
          content,
        },
      ],
      history: draftLead.history,
    };

    onDraftChange(nextLead);
    onPersist(nextLead);
    setNoteText("");
    setNoteType("informacao interna");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-slate-900/50 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.09em] text-slate-200">Nova observacao interna</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-[220px_1fr]">
          <label className="text-[11px] uppercase tracking-[0.09em] text-muted">
            Tipo
            <select
              className="field mt-1 h-9 px-2.5 py-1.5 text-xs"
              value={noteType}
              onChange={(event) => setNoteType(event.target.value as LeadObservationType)}
            >
              {observationTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] uppercase tracking-[0.09em] text-muted">
            Observacao
            <textarea
              className="field mt-1 min-h-24 px-2.5 py-1.5 text-xs"
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              placeholder="Escreva sua observacao interna."
            />
          </label>
        </div>
        <button type="button" className="btn-primary mt-3 h-9 px-3 py-1.5 text-xs" onClick={addObservation}>
          Adicionar observacao
        </button>
      </div>

      <div className="space-y-2">
        {visibleObservations.length === 0 ? (
          <div className="rounded-xl border border-border bg-slate-900/50 p-4 text-sm text-muted">Nenhuma observacao registrada.</div>
        ) : (
          visibleObservations.map((item) => (
              <article
                id={`lead-observation-${item.id}`}
                key={item.id}
                className={`rounded-xl border p-4 transition ${
                  highlightedObservationId === item.id
                    ? "border-emerald-400/60 bg-emerald-500/10"
                    : "border-border bg-slate-900/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-slate-800 px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-slate-300">{item.type}</span>
                  <p className="text-xs text-muted">
                    {item.date} - {item.time}
                  </p>
                </div>
                <p className="mt-2 text-sm text-slate-100">{item.content}</p>
                <p className="mt-2 text-xs text-muted">Responsavel: {item.owner || "-"}</p>
              </article>
            ))
        )}
      </div>
    </div>
  );
}

export function LeadDetailDrawer({ lead, open, onSave, onClose }: LeadDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("resumo");
  const [isEditing, setIsEditing] = useState(false);
  const [draftLead, setDraftLead] = useState<Lead | null>(lead);
  const [targetObservationId, setTargetObservationId] = useState<string | null>(null);

  useEffect(() => {
    setDraftLead(lead);
    setIsEditing(false);
    setActiveTab("resumo");
    setTargetObservationId(null);
  }, [lead?.id]);

  if (!open || !lead || !draftLead) return null;

  const persistDraft = (next: Lead) => {
    onSave(next);
  };

  const tabContent =
    activeTab === "resumo" ? (
      <LeadGeneralTab
        lead={lead}
        draftLead={draftLead}
        isEditing={isEditing}
        onActivateEdit={() => setIsEditing(true)}
        onEditingStateChange={setIsEditing}
        onDraftChange={setDraftLead}
      />
    ) : activeTab === "historico" ? (
      <LeadHistoryTab
        draftLead={draftLead}
        onOpenObservation={(observationId) => {
          setTargetObservationId(observationId);
          setActiveTab("observacoes");
        }}
      />
    ) : activeTab === "qualificacao" ? (
      <LeadIntelligenceTab
        draftLead={draftLead}
        isEditing={isEditing}
        onActivateEdit={() => setIsEditing(true)}
        onEditingStateChange={setIsEditing}
        onDraftChange={setDraftLead}
        onPersist={persistDraft}
      />
    ) : (
      <LeadObservationsTab
        draftLead={draftLead}
        onDraftChange={setDraftLead}
        onPersist={persistDraft}
        targetObservationId={targetObservationId}
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

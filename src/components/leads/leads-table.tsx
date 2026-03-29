"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Modal } from "@/components/ui/modal";
import { useResponsaveis } from "@/lib/responsaveis-store";
import { resolveResponsavelFromUser } from "@/lib/responsavel-resolver";
import { createDialSession } from "@/lib/post-call-flow";
import { Lead } from "@/types/crm";

type LeadsTableProps = {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  onSaveRow: (lead: Lead) => void;
};

type DialApiResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  data?: unknown;
};

type CallFeedback = {
  type: "success" | "error";
  message: string;
};

const channelBadgeClass: Record<Lead["channel"], string> = {
  inbound: "bg-emerald-500/20 text-emerald-300 border-emerald-400/40",
  outbound: "bg-sky-500/20 text-sky-300 border-sky-400/40",
};

function parseCityState(city: string): { city: string; state: string } {
  if (!city.trim()) return { city: "-", state: "-" };

  const normalized = city.replace(/\s+/g, " ").trim();
  if (normalized.includes(">")) {
    const [cityName, state] = normalized.split(">").map((part) => part.trim());
    return {
      city: cityName || "-",
      state: state || "-",
    };
  }
  if (normalized.includes("-")) {
    const [cityName, state] = normalized.split("-").map((part) => part.trim());
    return {
      city: cityName || "-",
      state: state || "-",
    };
  }

  return { city: normalized, state: "-" };
}

function formatDateBR(value?: string): string {
  if (!value) return "-";
  const [year = "", month = "", day = ""] = value.split("-");
  if (!year || !month || !day) return "-";
  return `${day}/${month}/${year}`;
}

function extractDialCallId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const source = payload as Record<string, unknown>;
  const direct = String(source.id || source.call_id || source.callId || source.uniqueid || "").trim();
  if (direct) return direct;

  const nested = source.data && typeof source.data === "object" ? (source.data as Record<string, unknown>) : null;
  if (!nested) return undefined;
  const nestedId = String(nested.id || nested.call_id || nested.callId || nested.uniqueid || "").trim();
  return nestedId || undefined;
}

const RESPONSAVEL_REQUIRED_MESSAGE =
  "Seu usuario ainda nao esta vinculado a um responsavel no CRM. Cadastre esse e-mail em Configuracoes > Responsaveis antes de realizar ligacoes.";

export function LeadsTable({ leads, onSelectLead, onSaveRow }: LeadsTableProps) {
  const { currentUser } = useAuth();
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const syncingScrollRef = useRef<"top" | "bottom" | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartScrollLeftRef = useRef(0);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const feedbackTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [rowDraft, setRowDraft] = useState<Lead | null>(null);
  const [scrollContentWidth, setScrollContentWidth] = useState(1850);
  const [isDragging, setIsDragging] = useState(false);
  const [callingLeadId, setCallingLeadId] = useState<string | null>(null);
  const [callFeedbackByLead, setCallFeedbackByLead] = useState<Record<string, CallFeedback>>({});
  const [responsavelMissingModalOpen, setResponsavelMissingModalOpen] = useState(false);

  const statusOptions = useMemo(
    () => ["Novo", "Contato iniciado", "Qualificado", "Reuniao marcada", "Proposta enviada", "Perdido", "Fechado"],
    [],
  );
  const tableRows = useMemo(
    () =>
      leads.map((lead) => ({
        lead,
        location: parseCityState(lead.city),
      })),
    [leads],
  );
  const ownerOptions = useResponsaveis();

  const openRowEdit = (lead: Lead) => {
    if (editingRowId === lead.id) {
      setEditingRowId(null);
      setRowDraft(null);
      return;
    }
    setEditingRowId(lead.id);
    setRowDraft({ ...lead });
  };

  const cancelRowEdit = () => {
    setEditingRowId(null);
    setRowDraft(null);
  };

  const saveRowEdit = () => {
    if (!rowDraft) return;
    onSaveRow(rowDraft);
    cancelRowEdit();
  };

  const setCallFeedback = (leadId: string, feedback: CallFeedback) => {
    setCallFeedbackByLead((prev) => ({ ...prev, [leadId]: feedback }));

    if (feedbackTimeoutsRef.current[leadId]) {
      clearTimeout(feedbackTimeoutsRef.current[leadId]);
    }

    feedbackTimeoutsRef.current[leadId] = setTimeout(() => {
      setCallFeedbackByLead((prev) => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      delete feedbackTimeoutsRef.current[leadId];
    }, 6000);
  };

  const callLead = async (lead: Lead) => {
    console.log("[POSTCALL_DEBUG] Clique no botao Ligar", {
      leadId: lead.id,
      nome: lead.name,
      telefone: lead.phone,
      timestamp: new Date().toISOString(),
    });

    if (!lead.phone) {
      setCallFeedback(lead.id, { type: "error", message: "Lead sem telefone para discagem." });
      return;
    }

    const resolvedResponsavel = resolveResponsavelFromUser(currentUser);
    if (!currentUser || !resolvedResponsavel.linked || !resolvedResponsavel.responsavel) {
      setCallFeedback(lead.id, {
        type: "error",
        message: RESPONSAVEL_REQUIRED_MESSAGE,
      });
      setResponsavelMissingModalOpen(true);
      return;
    }

    setCallingLeadId(lead.id);
    setCallFeedbackByLead((prev) => {
      const next = { ...prev };
      delete next[lead.id];
      return next;
    });

    try {
      const response = await fetch("/api/api4com/dial", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone: lead.phone,
          leadId: lead.id,
          nome: lead.name,
          empresa: lead.company,
          userId: currentUser?.id,
          responsavelId: resolvedResponsavel.responsavel.id,
          atendenteNome: resolvedResponsavel.responsavel.nome,
        }),
      });

      let data: DialApiResponse | null = null;
      try {
        data = (await response.json()) as DialApiResponse;
      } catch {
        data = null;
      }

      if (!response.ok || !data?.success) {
        setCallFeedback(lead.id, {
          type: "error",
          message: data?.message || data?.error || "Nao foi possivel disparar a ligacao.",
        });
        return;
      }

      setCallFeedback(lead.id, {
        type: "success",
        message: data.message || "Ligacao disparada com sucesso.",
      });

      const externalCallId = extractDialCallId(data?.data);
      console.log("[POSTCALL_DEBUG] CallId recebido no disparo", {
        leadId: lead.id,
        externalCallId: externalCallId || null,
      });

      const session = createDialSession({
        leadId: lead.id,
        nome: lead.name,
        empresa: lead.company,
        telefone: lead.phone,
        externalCallId,
        userId: currentUser?.id,
        responsavelId: resolvedResponsavel.responsavel.id,
        atendenteNome: resolvedResponsavel.responsavel.nome,
        sourcePath: typeof window !== "undefined" ? window.location.pathname : "/leads",
      });
      console.log("[POSTCALL_DEBUG] Sessao criada apos discagem", session);
    } catch {
      setCallFeedback(lead.id, {
        type: "error",
        message: "Falha de rede ao tentar ligar.",
      });
    } finally {
      setCallingLeadId(null);
    }
  };

  useEffect(() => {
    const syncWidth = () => {
      if (!tableRef.current) return;
      setScrollContentWidth(tableRef.current.scrollWidth);
    };

    syncWidth();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncWidth());
    if (tableRef.current) observer.observe(tableRef.current);
    if (bottomScrollRef.current) observer.observe(bottomScrollRef.current);

    return () => observer.disconnect();
  }, [leads.length]);

  useEffect(() => {
    return () => {
      Object.values(feedbackTimeoutsRef.current).forEach((timeoutId) => clearTimeout(timeoutId));
      feedbackTimeoutsRef.current = {};
    };
  }, []);

  const handleTopScroll = () => {
    if (!topScrollRef.current || !bottomScrollRef.current) return;
    if (syncingScrollRef.current === "bottom") {
      syncingScrollRef.current = null;
      return;
    }
    syncingScrollRef.current = "top";
    bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  };

  const handleBottomScroll = () => {
    if (!topScrollRef.current || !bottomScrollRef.current) return;
    if (syncingScrollRef.current === "top") {
      syncingScrollRef.current = null;
      return;
    }
    syncingScrollRef.current = "bottom";
    topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
  };

  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("button, input, select, textarea, a, label"));
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!bottomScrollRef.current) return;
    if (isInteractiveTarget(event.target)) return;

    isDraggingRef.current = true;
    setIsDragging(true);
    suppressClickRef.current = false;
    dragStartXRef.current = event.clientX;
    dragStartScrollLeftRef.current = bottomScrollRef.current.scrollLeft;
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current || !bottomScrollRef.current) return;
      const deltaX = event.clientX - dragStartXRef.current;
      if (Math.abs(deltaX) > 3) {
        suppressClickRef.current = true;
      }

      event.preventDefault();
      bottomScrollRef.current.scrollLeft = dragStartScrollLeftRef.current - deltaX;
    };

    const stopDragging = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", stopDragging);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, []);

  return (
    <div className="panel overflow-hidden">
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto border-b border-border/70 bg-slate-950/30"
        aria-label="Rolagem horizontal superior da tabela de leads"
      >
        <div style={{ width: scrollContentWidth, height: "14px" }} />
      </div>
      <div
        ref={bottomScrollRef}
        onScroll={handleBottomScroll}
        onMouseDown={handleMouseDown}
        className={`overflow-x-auto ${isDragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
      >
        <table ref={tableRef} className="w-full min-w-[1850px] text-left">
          <thead className="border-b border-border bg-slate-900/60 text-[11px] uppercase tracking-[0.08em] text-muted">
            <tr>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Nome</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Empresa</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Nicho</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Telefone</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Email</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Cidade</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Estado</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Status</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Canal</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Origem</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Responsavel</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Entrada no CRM</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Primeiro contato</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Acao</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({ lead, location }) => (
              <Fragment key={lead.id}>
                <tr
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    if (editingRowId !== lead.id) onSelectLead(lead);
                  }}
                  className="cursor-pointer border-b border-border/70 text-[13px] text-slate-200 transition-all duration-150 hover:bg-sky-900/35 hover:shadow-[inset_0_0_0_1px_rgba(56,189,248,0.28)] xl:text-sm"
                >
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{lead.name}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{lead.company}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{lead.niche || "-"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{lead.phone}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{lead.email}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{location.city}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{location.state}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{lead.status}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${channelBadgeClass[lead.channel]}`}
                    >
                      {lead.channel}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{lead.source}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{lead.owner}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{formatDateBR(lead.entryDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{formatDateBR(lead.firstContactDate)}</td>
                  <td className="w-[340px] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={callingLeadId === lead.id || !lead.phone}
                        onClick={(event) => {
                          event.stopPropagation();
                          void callLead(lead);
                        }}
                      >
                        {callingLeadId === lead.id ? "Ligando..." : "📞 Ligar"}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[11px] text-slate-200 transition hover:bg-slate-800"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectLead(lead);
                        }}
                      >
                        Ver lead
                      </button>
                      <button
                        type="button"
                        className={`rounded-md border px-2 py-1 text-[11px] text-slate-200 transition hover:bg-slate-800 ${
                          editingRowId === lead.id ? "border-emerald-400/40 bg-emerald-500/10" : "border-border"
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openRowEdit(lead);
                        }}
                      >
                        Editar linha
                      </button>
                    </div>
                    {callFeedbackByLead[lead.id] ? (
                      <p
                        className={`mt-1.5 text-[11px] ${
                          callFeedbackByLead[lead.id].type === "success" ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {callFeedbackByLead[lead.id].message}
                      </p>
                    ) : null}
                  </td>
                </tr>
                {editingRowId === lead.id && rowDraft ? (
                  <tr key={`${lead.id}-editor`} className="border-b border-border/70 bg-slate-950/40">
                    <td colSpan={14} className="px-3 py-3 xl:px-3.5">
                      <div className="rounded-lg border border-border bg-slate-900/60 p-3">
                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
                            Nome
                            <input
                              className="field mt-1 h-9 px-2.5 py-1.5 text-xs"
                              value={rowDraft.name}
                              onChange={(event) => setRowDraft({ ...rowDraft, name: event.target.value })}
                            />
                          </label>
                          <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
                            Empresa
                            <input
                              className="field mt-1 h-9 px-2.5 py-1.5 text-xs"
                              value={rowDraft.company}
                              onChange={(event) => setRowDraft({ ...rowDraft, company: event.target.value })}
                            />
                          </label>
                          <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
                            Telefone
                            <input
                              className="field mt-1 h-9 px-2.5 py-1.5 text-xs"
                              value={rowDraft.phone}
                              onChange={(event) => setRowDraft({ ...rowDraft, phone: event.target.value })}
                            />
                          </label>
                          <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
                            Email
                            <input
                              className="field mt-1 h-9 px-2.5 py-1.5 text-xs"
                              type="email"
                              value={rowDraft.email}
                              onChange={(event) => setRowDraft({ ...rowDraft, email: event.target.value })}
                            />
                          </label>
                          <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
                            Status
                            <select
                              className="field mt-1 h-9 px-2.5 py-1.5 text-xs"
                              value={rowDraft.status}
                              onChange={(event) =>
                                setRowDraft({ ...rowDraft, status: event.target.value as Lead["status"] })
                              }
                            >
                              {statusOptions.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
                            Responsavel
                            <select
                              className="field mt-1 h-9 px-2.5 py-1.5 text-xs"
                              value={rowDraft.owner}
                              onChange={(event) => setRowDraft({ ...rowDraft, owner: event.target.value })}
                            >
                              {ownerOptions.map((owner) => (
                                <option key={owner} value={owner}>
                                  {owner}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 text-xs text-emerald-200 transition hover:bg-emerald-500/30"
                            onClick={saveRowEdit}
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-border px-3 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800"
                            onClick={cancelRowEdit}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        title="Ligacao nao permitida"
        open={responsavelMissingModalOpen}
        onClose={() => setResponsavelMissingModalOpen(false)}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-200">
            {RESPONSAVEL_REQUIRED_MESSAGE}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary" onClick={() => setResponsavelMissingModalOpen(false)}>
              Entendi
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

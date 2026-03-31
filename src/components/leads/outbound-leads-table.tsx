"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Modal } from "@/components/ui/modal";
import { getLeadPhones } from "@/lib/lead-contact-utils";
import { resolveResponsavelFromUserAsync } from "@/lib/responsavel-resolver";
import { createDialSession, generateCallSessionId, resolveBlockingStateBeforeNewDial } from "@/lib/post-call-flow";
import { Lead } from "@/types/crm";

type OutboundLeadsTableProps = {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
};

type DialApiResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  externalCallId?: string | null;
  data?: unknown;
};

type CallFeedback = {
  type: "success" | "error";
  message: string;
};

const expedienteStyle: Record<"Aberto" | "Fechado" | "Indefinido", string> = {
  Aberto: "bg-emerald-500/20 text-emerald-300 border-emerald-400/40",
  Fechado: "bg-rose-500/20 text-rose-300 border-rose-400/40",
  Indefinido: "bg-slate-500/20 text-slate-400 border-slate-400/40",
};

function resolveExpediente(lead: Lead): "Aberto" | "Fechado" | "Indefinido" {
  const val = lead.expediente;
  if (!val) return "Indefinido";
  if (val === "Aberto") return "Aberto";
  if (val === "Fechado") return "Fechado";
  return "Indefinido";
}

function parseCityState(city: string): { city: string; state: string } {
  if (!city.trim()) return { city: "-", state: "-" };
  const normalized = city.replace(/\s+/g, " ").trim();
  if (normalized.includes(">")) {
    const [cityName, state] = normalized.split(">").map((p) => p.trim());
    return { city: cityName || "-", state: state || "-" };
  }
  if (normalized.includes("-")) {
    const [cityName, state] = normalized.split("-").map((p) => p.trim());
    return { city: cityName || "-", state: state || "-" };
  }
  return { city: normalized, state: "-" };
}

function formatDateBR(value?: string | null): string {
  if (!value) return "-";
  const [year = "", month = "", day = ""] = value.split("-");
  if (!year || !month || !day) return "-";
  return `${day}/${month}/${year}`;
}

function formatNota(value?: number | string | null): string {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (Number.isNaN(n)) return String(value);
  return n.toFixed(1);
}

function formatAvaliacoes(value?: number | string | null): string {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString("pt-BR");
}

function extractDialCallId(payload: unknown): string | undefined {
  const tryReadId = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const source = value as Record<string, unknown>;
    const direct = String(
      source.externalCallId || source.id || source.call_id || source.callId || source.uniqueid || "",
    ).trim();
    return direct || undefined;
  };
  const walk = (value: unknown, depth: number): string | undefined => {
    if (depth > 4) return undefined;
    const direct = tryReadId(value);
    if (direct) return direct;
    if (!value || typeof value !== "object") return undefined;
    const source = value as Record<string, unknown>;
    for (const nested of Object.values(source)) {
      if (nested && typeof nested === "object") {
        const found = walk(nested, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(payload, 0);
}

const RESPONSAVEL_REQUIRED_MESSAGE =
  "Seu usuario ainda nao esta vinculado a um responsavel no CRM. Cadastre esse e-mail em Configuracoes > Responsaveis antes de realizar ligacoes.";

export function OutboundLeadsTable({ leads, onSelectLead }: OutboundLeadsTableProps) {
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

  const [scrollContentWidth, setScrollContentWidth] = useState(2000);
  const [isDragging, setIsDragging] = useState(false);
  const [callingLeadId, setCallingLeadId] = useState<string | null>(null);
  const [callFeedbackByLead, setCallFeedbackByLead] = useState<Record<string, CallFeedback>>({});
  const [responsavelMissingModalOpen, setResponsavelMissingModalOpen] = useState(false);
  const [phonePickerLead, setPhonePickerLead] = useState<Lead | null>(null);
  const [selectedDialPhone, setSelectedDialPhone] = useState("");

  const tableRows = useMemo(
    () =>
      leads.map((lead) => ({
        lead,
        location: parseCityState(lead.city),
        expediente: resolveExpediente(lead),
      })),
    [leads],
  );

  const setCallFeedback = (leadId: string, feedback: CallFeedback) => {
    setCallFeedbackByLead((prev) => ({ ...prev, [leadId]: feedback }));
    if (feedbackTimeoutsRef.current[leadId]) clearTimeout(feedbackTimeoutsRef.current[leadId]);
    feedbackTimeoutsRef.current[leadId] = setTimeout(() => {
      setCallFeedbackByLead((prev) => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      delete feedbackTimeoutsRef.current[leadId];
    }, 6000);
  };

  const callLead = async (lead: Lead, phoneToDial: string) => {
    if (!phoneToDial) {
      setCallFeedback(lead.id, { type: "error", message: "Lead sem telefone para discagem." });
      return;
    }
    const sessionController = new AbortController();
    const blocking = await resolveBlockingStateBeforeNewDial(sessionController.signal);
    if (blocking.blocked && blocking.session) {
      const blockingMessage =
        blocking.reason === "pending_wrapup"
          ? "Existe uma ligacao encerrada aguardando finalizacao obrigatoria. Finalize antes de iniciar outra."
          : "Existe uma ligacao em andamento. Conclua essa chamada antes de iniciar outra.";
      setCallFeedback(lead.id, { type: "error", message: blockingMessage });
      if (typeof window !== "undefined" && blocking.reason === "pending_wrapup") {
        window.location.assign("/ligacoes?postCall=1");
      }
      return;
    }
    const resolvedResponsavel = await resolveResponsavelFromUserAsync(currentUser);
    if (!currentUser || !resolvedResponsavel.linked || !resolvedResponsavel.responsavel) {
      setCallFeedback(lead.id, { type: "error", message: RESPONSAVEL_REQUIRED_MESSAGE });
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
      const sessionId = generateCallSessionId();
      const response = await fetch("/api/api4com/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          phone: phoneToDial,
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
      setCallFeedback(lead.id, { type: "success", message: data.message || "Ligacao disparada com sucesso." });
      const externalCallId = extractDialCallId(data);
      const session = createDialSession({
        sessionId,
        leadId: lead.id,
        nome: lead.name,
        empresa: lead.company,
        telefone: phoneToDial,
        externalCallId,
        userId: currentUser?.id,
        responsavelId: resolvedResponsavel.responsavel.id,
        atendenteNome: resolvedResponsavel.responsavel.nome,
        sourcePath: typeof window !== "undefined" ? window.location.pathname : "/leads",
      });
      if (typeof window !== "undefined") {
        window.location.assign(`/ligacoes?postCall=1&sessionId=${encodeURIComponent(session.sessionId)}`);
      }
    } catch {
      setCallFeedback(lead.id, { type: "error", message: "Falha de rede ao tentar ligar." });
    } finally {
      setCallingLeadId(null);
    }
  };

  const requestDial = (lead: Lead) => {
    const phones = getLeadPhones(lead);
    if (phones.length === 0) {
      setCallFeedback(lead.id, { type: "error", message: "Lead sem telefone para discagem." });
      return;
    }
    if (phones.length === 1) {
      void callLead(lead, phones[0]);
      return;
    }
    setPhonePickerLead(lead);
    setSelectedDialPhone(phones[0]);
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
      Object.values(feedbackTimeoutsRef.current).forEach((id) => clearTimeout(id));
      feedbackTimeoutsRef.current = {};
    };
  }, []);

  const handleTopScroll = () => {
    if (!topScrollRef.current || !bottomScrollRef.current) return;
    if (syncingScrollRef.current === "bottom") { syncingScrollRef.current = null; return; }
    syncingScrollRef.current = "top";
    bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  };

  const handleBottomScroll = () => {
    if (!topScrollRef.current || !bottomScrollRef.current) return;
    if (syncingScrollRef.current === "top") { syncingScrollRef.current = null; return; }
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
      if (Math.abs(deltaX) > 3) suppressClickRef.current = true;
      event.preventDefault();
      bottomScrollRef.current.scrollLeft = dragStartScrollLeftRef.current - deltaX;
    };
    const stopDragging = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      setTimeout(() => { suppressClickRef.current = false; }, 0);
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
        aria-label="Rolagem horizontal superior da tabela de leads outbound"
      >
        <div style={{ width: scrollContentWidth, height: "14px" }} />
      </div>
      <div
        ref={bottomScrollRef}
        onScroll={handleBottomScroll}
        onMouseDown={handleMouseDown}
        className={`overflow-x-auto ${isDragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
      >
        <table ref={tableRef} className="w-full min-w-[2000px] text-left">
          <thead className="border-b border-border bg-slate-900/60 text-[11px] uppercase tracking-[0.08em] text-muted">
            <tr>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Empresa</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Responsavel</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Telefone</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Email</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Site</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Expediente</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Nota</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Avaliacoes</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Cidade</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Estado</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Data de Cadastro</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Origem</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Acao</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({ lead, location, expediente }) => (
              <tr
                key={lead.id}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  onSelectLead(lead);
                }}
                className="cursor-pointer border-b border-border/70 text-[13px] text-slate-200 transition-all duration-150 hover:bg-sky-900/35 hover:shadow-[inset_0_0_0_1px_rgba(56,189,248,0.28)] xl:text-sm"
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-medium xl:px-3.5 2xl:py-2">
                  {lead.company || "-"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {lead.name !== lead.company ? lead.name || "-" : "-"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {(() => {
                    const phones = getLeadPhones(lead);
                    if (phones.length === 0) return "-";
                    if (phones.length === 1) return phones[0];
                    return `${phones[0]} (+${phones.length - 1})`;
                  })()}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {lead.email || "-"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {lead.site ? (
                    <a
                      href={lead.site.startsWith("http") ? lead.site : `https://${lead.site}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-sky-400 underline underline-offset-2 transition hover:text-sky-300"
                    >
                      {lead.site}
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${expedienteStyle[expediente]}`}
                  >
                    {expediente}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {formatNota(lead.nota)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {formatAvaliacoes(lead.avaliacoes)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{location.city}</td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{location.state}</td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {formatDateBR(lead.entryDate)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {lead.source || "-"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={callingLeadId === lead.id || getLeadPhones(lead).length === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDial(lead);
                      }}
                    >
                      {callingLeadId === lead.id ? "Ligando..." : "📞 Ligar"}
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
          <p className="text-sm text-slate-200">{RESPONSAVEL_REQUIRED_MESSAGE}</p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary" onClick={() => setResponsavelMissingModalOpen(false)}>
              Entendi
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Selecionar telefone"
        open={Boolean(phonePickerLead)}
        onClose={() => {
          setPhonePickerLead(null);
          setSelectedDialPhone("");
        }}
      >
        {phonePickerLead ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-200">
              Escolha o numero para ligar para <span className="font-semibold">{phonePickerLead.name}</span>.
            </p>
            <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
              Telefones disponiveis
              <select
                className="field mt-1 h-9 px-2.5 py-1.5 text-xs"
                value={selectedDialPhone}
                onChange={(e) => setSelectedDialPhone(e.target.value)}
              >
                {getLeadPhones(phonePickerLead).map((phone) => (
                  <option key={phone} value={phone}>
                    {phone}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost h-9 px-3 py-1.5 text-xs"
                onClick={() => {
                  setPhonePickerLead(null);
                  setSelectedDialPhone("");
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary h-9 px-3 py-1.5 text-xs"
                onClick={() => {
                  if (!phonePickerLead || !selectedDialPhone) return;
                  const lead = phonePickerLead;
                  const phone = selectedDialPhone;
                  setPhonePickerLead(null);
                  setSelectedDialPhone("");
                  void callLead(lead, phone);
                }}
              >
                Iniciar ligacao
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

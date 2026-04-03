"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { inferAgendaChannelFromType, inferAgendaEventTypeFromReason } from "@/lib/agenda-events";
import { getLeadsSnapshot, subscribeLeadsSnapshot } from "@/lib/crm-data-store";
import { getLeadEmails, getLeadNames, getLeadPhones } from "@/lib/lead-contact-utils";
import { CallReason, Lead, Meeting } from "@/types/crm";

export type AppointmentManualAction = "done" | "cancel" | "reschedule" | "no_show";

type AppointmentModalProps = {
  open: boolean;
  isNew: boolean;
  meeting: Meeting | null;
  onClose: () => void;
  onChange: (meeting: Meeting) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onManualAction?: (action: AppointmentManualAction) => void;
};

const reasonOptions: CallReason[] = ["apresentacao", "acompanhamento", "fechamento", "follow-up"];

type LeadSearchItem = {
  id: string;
  displayName: string;
  company: string;
  phones: string[];
  emails: string[];
  searchText: string;
};

function normalizeText(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function AppointmentModal({
  open,
  isNew,
  meeting,
  onClose,
  onChange,
  onSubmit,
  onManualAction,
}: AppointmentModalProps) {
  const [leads, setLeads] = useState<Lead[]>(() => getLeadsSnapshot());
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sync = () => setLeads(getLeadsSnapshot());
    sync();
    return subscribeLeadsSnapshot(sync);
  }, []);

  useEffect(() => {
    if (!meeting) {
      setQuery("");
      setDropdownOpen(false);
      return;
    }
    setQuery(meeting.personName || "");
    setDropdownOpen(false);
  }, [meeting?.id, open]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!searchContainerRef.current) return;
      if (searchContainerRef.current.contains(event.target as Node)) return;
      setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  const leadSearchItems = useMemo<LeadSearchItem[]>(() => {
    return leads.map((lead) => {
      const names = getLeadNames(lead);
      const displayName = String(names[0] || lead.name || lead.company || "").trim() || "Lead sem nome";
      const company = String(lead.company || "").trim();
      const phones = getLeadPhones(lead);
      const emails = getLeadEmails(lead);
      const searchText = normalizeText(
        [
          displayName,
          ...names,
          company,
          ...phones,
          ...emails,
          lead.phone || "",
          lead.email || "",
        ].join(" "),
      );
      return {
        id: lead.id,
        displayName,
        company,
        phones,
        emails,
        searchText,
      };
    });
  }, [leads]);

  const filteredLeadItems = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return [];
    return leadSearchItems.filter((item) => item.searchText.includes(normalizedQuery)).slice(0, 12);
  }, [leadSearchItems, query]);

  const shouldShowDropdown = dropdownOpen && query.trim().length > 0;

  return (
    <Modal title={isNew ? "Novo Agendamento" : "Detalhes do Agendamento"} open={open} onClose={onClose}>
      {meeting ? (
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="relative" ref={searchContainerRef}>
            <label className="block text-sm">
              Nome do cliente
              <input
                className="field mt-1"
                value={query}
                onChange={(e) => {
                  const value = e.target.value;
                  setQuery(value);
                  setDropdownOpen(Boolean(value.trim()));
                  onChange({
                    ...meeting,
                    personName: value,
                    leadId: null,
                  });
                }}
                onFocus={() => setDropdownOpen(Boolean(query.trim()))}
                placeholder="Busque por nome, empresa, telefone ou e-mail"
                autoComplete="off"
                required
              />
            </label>
            {shouldShowDropdown ? (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-xl">
                {filteredLeadItems.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Nenhum lead encontrado para essa busca.</p>
                ) : (
                  filteredLeadItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full rounded-md px-3 py-2 text-left transition hover:bg-slate-800"
                      onClick={() => {
                        setQuery(item.displayName);
                        setDropdownOpen(false);
                        onChange({
                          ...meeting,
                          personName: item.displayName,
                          leadId: item.id,
                        });
                      }}
                    >
                      <p className="text-sm font-semibold text-slate-100">{item.displayName}</p>
                      <p className="text-xs text-slate-300">{item.company || "Empresa nao informada"}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {(item.phones[0] || "-")} | {(item.emails[0] || "-")}
                      </p>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Data
              <input
                className="field mt-1"
                type="date"
                value={meeting.date}
                onChange={(e) => onChange({ ...meeting, date: e.target.value })}
                required
              />
            </label>
            <label className="text-sm">
              Horario da call
              <input
                className="field mt-1"
                type="time"
                value={meeting.callTime}
                onChange={(e) => onChange({ ...meeting, callTime: e.target.value })}
                required
              />
            </label>
          </div>
          <label className="block text-sm">
            Motivo da call
            <select
              className="field mt-1"
              value={meeting.reason}
              onChange={(e) => {
                const reason = e.target.value as CallReason;
                const eventType = inferAgendaEventTypeFromReason(reason);
                onChange({
                  ...meeting,
                  reason,
                  eventType,
                  channel: inferAgendaChannelFromType(eventType),
                });
              }}
            >
              {reasonOptions.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Responsavel
            <input className="field mt-1" value={meeting.owner} readOnly />
          </label>
          <label className="block text-sm">
            Observacoes
            <textarea
              className="field mt-1 min-h-24"
              value={meeting.notes || ""}
              onChange={(e) => onChange({ ...meeting, notes: e.target.value })}
            />
          </label>

          {!isNew ? (
            <div className="rounded-lg border border-border bg-slate-900/50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Finalizacao manual</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                  onClick={() => onManualAction?.("done")}
                >
                  1 - Acao realizada
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
                  onClick={() => onManualAction?.("cancel")}
                >
                  2 - Cancelar acao
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20"
                  onClick={() => onManualAction?.("reschedule")}
                >
                  3 - Reagendar acao
                </button>
                {meeting.reason === "fechamento" ? (
                  <button
                    type="button"
                    className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                    onClick={() => onManualAction?.("no_show")}
                  >
                    No-Show
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <button type="submit" className="btn-primary">
            Salvar alteracoes
          </button>
        </form>
      ) : null}
    </Modal>
  );
}

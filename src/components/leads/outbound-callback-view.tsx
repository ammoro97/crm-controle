"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  getLeadsSnapshot,
  getMeetingsSnapshot,
  setLeadsSnapshot,
  subscribeLeadsSnapshot,
} from "@/lib/crm-data-store";
import { getLeadEmails, getLeadNames, getLeadPhones } from "@/lib/lead-contact-utils";
import { Lead, LeadFinalizationReason } from "@/types/crm";
import { LeadDetailDrawer } from "./lead-detail-drawer";
import { OutboundLeadsTable } from "./outbound-leads-table";

function normalizeLead(lead: Lead): Lead {
  return {
    ...lead,
    history: Array.isArray(lead.history) ? lead.history : [],
    internalNotes: Array.isArray(lead.internalNotes) ? lead.internalNotes : [],
    observationLog: Array.isArray(lead.observationLog) ? lead.observationLog : [],
  };
}

function normalizeQueryText(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function OutboundCallbackView() {
  const [leads, setLeads] = useState<Lead[]>(() =>
    getLeadsSnapshot()
      .map(normalizeLead)
      .filter((lead) => lead.channel === "outbound" && !!lead.callbackAt),
  );

  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInitialIsEditing, setDetailInitialIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(() => {
    return subscribeLeadsSnapshot(() => {
      setLeads(
        getLeadsSnapshot()
          .map(normalizeLead)
          .filter((lead) => lead.channel === "outbound" && !!lead.callbackAt),
      );
    });
  }, []);

  const detailLead = useMemo(
    () => leads.find((lead) => lead.id === detailLeadId) ?? null,
    [detailLeadId, leads],
  );

  const filteredLeads = useMemo(() => {
    const normalizedSearch = normalizeQueryText(deferredSearchTerm);
    if (!normalizedSearch) return leads;

    return leads.filter((lead) => {
      const haystack = [
        normalizeQueryText(lead.name),
        ...getLeadNames(lead).map((name) => normalizeQueryText(name)),
        normalizeQueryText(lead.company),
        normalizeQueryText(lead.phone),
        ...getLeadPhones(lead).map((phone) => normalizeQueryText(phone)),
        normalizeQueryText(lead.email),
        ...getLeadEmails(lead).map((email) => normalizeQueryText(email)),
      ];
      return haystack.some((value) => value.includes(normalizedSearch));
    });
  }, [deferredSearchTerm, leads]);

  const openLeadDetails = (lead: Lead) => {
    setDetailInitialIsEditing(false);
    setDetailLeadId(lead.id);
    setDetailOpen(true);
  };

  const openLeadForEditing = (lead: Lead) => {
    setDetailInitialIsEditing(true);
    setDetailLeadId(lead.id);
    setDetailOpen(true);
  };

  const updateLeadById = (workingLead: Lead) => {
    const allLeads = getLeadsSnapshot();
    const nextAll = allLeads.map((lead) => {
      if (lead.id !== workingLead.id) return lead;
      return { ...workingLead, history: lead.history, lastInteraction: lead.lastInteraction };
    });
    setLeadsSnapshot(nextAll);
  };

  const deleteLeadsById = (ids: string[]) => {
    const toDelete = new Set(ids);
    const allLeads = getLeadsSnapshot();
    const meetings = getMeetingsSnapshot();
    const toArchive = allLeads.filter((lead) => toDelete.has(lead.id));
    const nextAll = allLeads.filter((lead) => !toDelete.has(lead.id));
    const now = new Date().toISOString();
    const archiveEntries = toArchive.map((lead) => ({
      lead,
      meetings: meetings.filter((m) => m.leadId === lead.id),
      finalizadoEm: now,
      motivo: "finalizado_apagar",
    }));
    setLeadsSnapshot(nextAll, undefined, archiveEntries);
  };

  const finalizeLeadViaProfile = (
    leadToFinalize: Lead,
    _reason: LeadFinalizationReason,
    _saleValueCents?: number,
  ): boolean => {
    // Finalizacao via perfil nao habilitada na aba Callback
    void leadToFinalize;
    return false;
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        {leads.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800/60">
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-slate-500" stroke="currentColor" strokeWidth="1.5">
                <path
                  d="M3 5.5C3 10.748 7.252 15 12.5 15h.5v4l4-4a9 9 0 1 0-14-9.5z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="mt-4 text-sm font-medium text-slate-300">Nenhum lead em callback</p>
            <p className="mt-1 text-xs text-slate-500">
              Leads enviados para callback aparecem aqui.
            </p>
          </div>
        ) : (
          <>
            <section className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-lg">
                <svg
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <circle cx="6.5" cy="6.5" r="4.5" />
                  <path d="M10.5 10.5l3 3" strokeLinecap="round" />
                </svg>
                <input
                  className="field h-9 w-full pl-8 pr-3 text-[13px]"
                  placeholder="Buscar contato por nome, empresa, telefone ou email..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
              <span className="text-[11px] text-slate-400">
                {filteredLeads.length} de {leads.length} leads
              </span>
            </section>
            <OutboundLeadsTable
              leads={filteredLeads}
              onSelectLead={openLeadDetails}
              onEditLead={openLeadForEditing}
              onDeleteLeads={deleteLeadsById}
              mode="callback"
            />
          </>
        )}
      </div>

      <LeadDetailDrawer
        key={detailLead?.id ?? "callback-drawer"}
        lead={detailLead}
        open={detailOpen}
        onSave={updateLeadById}
        onFinalizeLead={finalizeLeadViaProfile}
        showFinalizeAction={false}
        initialIsEditing={detailInitialIsEditing}
        onClose={() => {
          setDetailOpen(false);
          setDetailLeadId(null);
          setDetailInitialIsEditing(false);
        }}
      />
    </>
  );
}

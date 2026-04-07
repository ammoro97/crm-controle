"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getLeadsSnapshot,
  getMeetingsSnapshot,
  setLeadsSnapshot,
  subscribeLeadsSnapshot,
} from "@/lib/crm-data-store";
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

export function OutboundCallbackView() {
  const [leads, setLeads] = useState<Lead[]>(() =>
    getLeadsSnapshot()
      .map(normalizeLead)
      .filter((lead) => lead.channel === "outbound" && !!lead.callbackAt),
  );

  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInitialIsEditing, setDetailInitialIsEditing] = useState(false);

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
          <OutboundLeadsTable
            leads={leads}
            onSelectLead={openLeadDetails}
            onEditLead={openLeadForEditing}
            onDeleteLeads={deleteLeadsById}
          />
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

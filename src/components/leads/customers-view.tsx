"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { PageTopbar } from "@/components/layout/page-topbar";
import { LeadDetailDrawer } from "@/components/leads/lead-detail-drawer";
import { getCustomersSnapshot, setCustomersSnapshot, subscribeCustomersSnapshot } from "@/lib/crm-data-store";
import { getLeadEmails, getLeadPhones } from "@/lib/lead-contact-utils";
import { Lead } from "@/types/crm";
import { TruncatedCellText } from "./table-cell-truncate";

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDateBRFromIsoDate(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const [year = "", month = "", day = ""] = raw.split("-");
  if (!year || !month || !day) return "-";
  return `${day}/${month}/${year}`;
}

function formatDateTimeBR(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseCityState(city: string): { city: string; state: string } {
  const normalized = String(city || "").trim().replace(/\s+/g, " ");
  if (!normalized) return { city: "-", state: "-" };
  if (normalized.includes(">")) {
    const [cityName, state] = normalized.split(">").map((part) => part.trim());
    return { city: cityName || "-", state: state || "-" };
  }
  if (normalized.includes("-")) {
    const [cityName, state] = normalized.split("-").map((part) => part.trim());
    return { city: cityName || "-", state: state || "-" };
  }
  return { city: normalized, state: "-" };
}

export function CustomersView() {
  const [customers, setCustomers] = useState<Lead[]>(() => getCustomersSnapshot());
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInitialTab, setDetailInitialTab] = useState<"resumo" | "historico" | "qualificacao" | "observacoes" | "agenda">("resumo");

  useEffect(() => {
    const sync = () => {
      setCustomers(getCustomersSnapshot());
    };
    sync();
    return subscribeCustomersSnapshot(sync);
  }, []);

  const visibleCustomers = useMemo(() => {
    const sorted = [...customers].sort((a, b) => a.company.localeCompare(b.company));
    const normalizedSearch = normalizeText(deferredSearchTerm);
    if (!normalizedSearch) return sorted;
    return sorted.filter((lead) => {
      const haystack = [
        normalizeText(lead.name),
        normalizeText(lead.company),
        normalizeText(lead.phone),
        ...getLeadPhones(lead).map((phone) => normalizeText(phone)),
        normalizeText(lead.email),
        ...getLeadEmails(lead).map((email) => normalizeText(email)),
      ];
      return haystack.some((value) => value.includes(normalizedSearch));
    });
  }, [customers, deferredSearchTerm]);

  const detailLead = useMemo(() => {
    return customers.find((lead) => lead.id === detailLeadId) || null;
  }, [customers, detailLeadId]);

  const updateCustomerById = (updatedLead: Lead) => {
    setCustomers((prev) => {
      const next = prev.map((lead) => (lead.id === updatedLead.id ? { ...lead, ...updatedLead } : lead));
      setCustomersSnapshot(next);
      return next;
    });
  };

  return (
    <section>
      <PageTopbar
        title="Clientes"
        showSearch={false}
        actionsSlot={
          <button
            type="button"
            className="btn-ghost h-10 px-4 text-sm"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
          >
            Atualizar pagina
          </button>
        }
      />

      <section className="panel mb-3 p-3 xl:p-3.5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <label className="w-full text-[11px] font-medium uppercase tracking-[0.08em] text-muted md:max-w-xl">
            Busca global de clientes
            <input
              className="field mt-1.5 h-9 px-2.5 py-1.5 text-xs xl:text-[13px]"
              placeholder="Buscar por nome, empresa, telefone ou email"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <div className="rounded-md border border-border bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
            Total de clientes: <span className="font-semibold text-slate-100">{customers.length}</span>
          </div>
        </div>
      </section>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[1300px] text-left">
          <thead className="border-b border-border bg-slate-900/60 text-[11px] uppercase tracking-[0.08em] text-muted">
            <tr>
              <th className="w-[14rem] px-3 py-2.5 xl:px-3.5 2xl:py-2">Empresa</th>
              <th className="w-[12rem] px-3 py-2.5 xl:px-3.5 2xl:py-2">Contato</th>
              <th className="w-[14rem] px-3 py-2.5 xl:px-3.5 2xl:py-2">Responsavel</th>
              <th className="w-[14rem] px-3 py-2.5 xl:px-3.5 2xl:py-2">Telefone</th>
              <th className="w-[14rem] px-3 py-2.5 xl:px-3.5 2xl:py-2">Email</th>
              <th className="w-[11rem] px-3 py-2.5 xl:px-3.5 2xl:py-2">Cidade</th>
              <th className="w-[8rem] px-3 py-2.5 xl:px-3.5 2xl:py-2">Estado</th>
              <th className="w-[10rem] px-3 py-2.5 xl:px-3.5 2xl:py-2">Canal Origem</th>
              <th className="w-[12rem] px-3 py-2.5 xl:px-3.5 2xl:py-2">Cliente Desde</th>
            </tr>
          </thead>
          <tbody>
            {visibleCustomers.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-sm text-slate-400 xl:px-3.5" colSpan={9}>
                  Nenhum cliente convertido encontrado.
                </td>
              </tr>
            ) : (
              visibleCustomers.map((lead) => {
                const location = parseCityState(lead.city);
                return (
                  <tr
                    key={lead.id}
                    className="cursor-pointer border-b border-border/70 text-[13px] text-slate-200 transition hover:bg-sky-900/30 xl:text-sm"
                    onClick={() => {
                      setDetailLeadId(lead.id);
                      setDetailInitialTab("resumo");
                      setDetailOpen(true);
                    }}
                  >
                    <td className="px-3 py-2.5 font-medium xl:px-3.5 2xl:py-2">
                      <TruncatedCellText value={lead.company} fallback="-" widthClass="w-[14rem] max-w-[14rem]" />
                    </td>
                    <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">
                      <TruncatedCellText value={lead.name} fallback="-" widthClass="w-[12rem] max-w-[12rem]" />
                    </td>
                    <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">
                      <TruncatedCellText value={lead.owner} fallback="-" widthClass="w-[14rem] max-w-[14rem]" />
                    </td>
                    <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">
                      <TruncatedCellText value={lead.phone} fallback="-" widthClass="w-[14rem] max-w-[14rem]" />
                    </td>
                    <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">
                      <TruncatedCellText value={lead.email} fallback="-" widthClass="w-[14rem] max-w-[14rem]" />
                    </td>
                    <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">{location.city}</td>
                    <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">{location.state}</td>
                    <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">{lead.channel}</td>
                    <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">{formatDateTimeBR(lead.convertedToCustomerAt)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <LeadDetailDrawer
        key={detailLead?.id ?? "clientes-drawer"}
        lead={detailLead}
        open={detailOpen}
        onSave={updateCustomerById}
        initialTab={detailInitialTab}
        showFinalizeAction={false}
        onFinalizeLead={(lead, reason, saleValueCents) => {
          void lead;
          void reason;
          void saleValueCents;
          return false;
        }}
        onClose={() => {
          setDetailOpen(false);
          setDetailLeadId(null);
          setDetailInitialTab("resumo");
        }}
      />
    </section>
  );
}

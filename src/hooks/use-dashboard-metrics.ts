"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardMetrics } from "@/types/dashboard";
import type { Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";
import type { PostCallWrapup } from "@/lib/post-call-flow";

type ApiSuccessResponse = {
  success: true;
  metrics: DashboardMetrics;
};

type ApiErrorResponse = {
  success: false;
  message?: string;
};

type DashboardMetricsResponse = ApiSuccessResponse | ApiErrorResponse;

type DashboardMetricsRequestBody = {
  leads: Lead[];
  meetings: Meeting[];
  finalizations: LeadFinalizationRecord[];
  wrapups: PostCallWrapup[];
};

const LEADS_STORAGE_KEY = "crm.leads.v1";
const MEETINGS_STORAGE_KEY = "crm.agenda.meetings.v1";
const LEAD_FINALIZATIONS_STORAGE_KEY = "crm.leads.finalizations.v1";
const WRAPUPS_STORAGE_KEY = "crm.calls.wrapups.v1";

const EMPTY_METRICS: DashboardMetrics = {
  funnel: {
    ligacoes: 0,
    atendidas: 0,
    decisor: 0,
    agendamentos: 0,
  },
  cards: {
    acionamentoBase: 0,
    faturamento: 0,
    vendasRealizadas: 0,
    leadDesqualificado: 0,
    followUpsPendentes: 0,
    conversaoLigacao: 0,
    percentualAtendimento: 0,
    percentualCpc: 0,
    noShow: 0,
  },
};

function readSnapshotArray<T>(storageKey: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function readDashboardRequestBody(): DashboardMetricsRequestBody {
  return {
    leads: readSnapshotArray<Lead>(LEADS_STORAGE_KEY),
    meetings: readSnapshotArray<Meeting>(MEETINGS_STORAGE_KEY),
    finalizations: readSnapshotArray<LeadFinalizationRecord>(LEAD_FINALIZATIONS_STORAGE_KEY),
    wrapups: readSnapshotArray<PostCallWrapup>(WRAPUPS_STORAGE_KEY),
  };
}

export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const payload = readDashboardRequestBody();
      const response = await fetch("/api/dashboard/metrics", {
        method: "POST",
        cache: "no-store",
        signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as DashboardMetricsResponse;

      if (!response.ok || !data.success) {
        setError(data.success ? "Nao foi possivel carregar metricas do dashboard." : data.message || "Erro ao buscar metricas.");
        return;
      }

      setMetrics(data.metrics);
    } catch {
      setError("Nao foi possivel carregar metricas do dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMetrics(controller.signal);
    return () => controller.abort();
  }, [fetchMetrics]);

  const refresh = useCallback(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  return useMemo(
    () => ({
      metrics,
      loading,
      error,
      refresh,
    }),
    [error, loading, metrics, refresh],
  );
}

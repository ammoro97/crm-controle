"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardMetrics } from "@/types/dashboard";

type ApiSuccessResponse = {
  success: true;
  metrics: DashboardMetrics;
};

type ApiErrorResponse = {
  success: false;
  message?: string;
};

type DashboardMetricsResponse = ApiSuccessResponse | ApiErrorResponse;

const LEADS_STORAGE_KEY = "crm.leads.v1";
const MEETINGS_STORAGE_KEY = "crm.agenda.meetings.v1";
const LEAD_FINALIZATIONS_STORAGE_KEY = "crm.leads.finalizations.v1";
const WRAPUPS_STORAGE_KEY = "crm.calls.wrapups.v1";
const REFRESH_EVENT_KEYS = new Set([
  LEADS_STORAGE_KEY,
  MEETINGS_STORAGE_KEY,
  LEAD_FINALIZATIONS_STORAGE_KEY,
  WRAPUPS_STORAGE_KEY,
]);
const REFRESH_EVENTS = [
  "crm:leads:changed",
  "crm:meetings:changed",
  "crm:lead-finalizations:changed",
  "crm:calls:flow:changed",
];

const EMPTY_METRICS: DashboardMetrics = {
  funnels: {
    absoluto: {
      ligacoes: 0,
      atendidas: 0,
      decisor: 0,
      agendamentos: 0,
      compras: 0,
    },
    conversao: {
      atendidasPercentual: 0,
      decisorPercentual: 0,
      agendamentosPercentual: 0,
      comprasPercentual: 0,
    },
  },
  cards: {
    acionamentoBase: 0,
    faturamento: 0,
    vendasRealizadas: 0,
    leadDesqualificado: 0,
    followUpsPendentes: 0,
    conversaoLigacao: 0,
    taxaSemInteresse: 0,
    percentualAtendimento: 0,
    percentualCpc: 0,
    noShow: 0,
  },
};

export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/dashboard/metrics", {
        method: "GET",
        cache: "no-store",
        signal,
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    let debounceTimeout: number | null = null;
    let mounted = true;

    const triggerRefresh = () => {
      if (!mounted) return;
      if (debounceTimeout !== null) {
        window.clearTimeout(debounceTimeout);
      }
      debounceTimeout = window.setTimeout(() => {
        void fetchMetrics();
      }, 700);
    };

    const onStorage = (event: StorageEvent) => {
      if (!event.key || !REFRESH_EVENT_KEYS.has(event.key)) return;
      triggerRefresh();
    };

    window.addEventListener("storage", onStorage);
    REFRESH_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, triggerRefresh);
    });

    const intervalId = window.setInterval(triggerRefresh, 45000);

    return () => {
      mounted = false;
      if (debounceTimeout !== null) {
        window.clearTimeout(debounceTimeout);
      }
      window.clearInterval(intervalId);
      window.removeEventListener("storage", onStorage);
      REFRESH_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, triggerRefresh);
      });
    };
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

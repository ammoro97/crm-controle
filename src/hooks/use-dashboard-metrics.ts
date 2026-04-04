"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardFilters, DashboardMetrics } from "@/types/dashboard";

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
    taxaContatoDecisor: 0,
    agendamentosPorLigacoes: 0,
    taxaSemInteresse: 0,
    percentualAtendimento: 0,
    percentualCpc: 0,
    noShow: 0,
  },
};

function buildMetricsUrl(filters: DashboardFilters) {
  const params = new URLSearchParams();
  params.set("periodo", filters.periodo);
  if (filters.periodo === "custom") {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }
  if (filters.vendedorId) {
    params.set("vendedorId", filters.vendedorId);
  }
  return `/api/dashboard/metrics?${params.toString()}`;
}

export function useDashboardMetrics(filters: DashboardFilters) {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestUrl = useMemo(
    () => buildMetricsUrl(filters),
    [filters.periodo, filters.from, filters.to, filters.vendedorId],
  );

  const activeRequest = useRef<AbortController | null>(null);
  const lastRequestUrl = useRef<string>("");

  const fetchMetrics = useCallback(
    async (options?: { silent?: boolean; force?: boolean }) => {
      const silent = Boolean(options?.silent);
      const force = Boolean(options?.force);
      if (!force && lastRequestUrl.current === requestUrl && silent) {
        return;
      }

      if (activeRequest.current) {
        activeRequest.current.abort();
      }
      const controller = new AbortController();
      activeRequest.current = controller;

      if (!silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const response = await fetch(requestUrl, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as DashboardMetricsResponse;

        if (!response.ok || !data.success) {
          if (!controller.signal.aborted) {
            setError(
              data.success
                ? "Nao foi possivel carregar metricas do dashboard."
                : data.message || "Erro ao buscar metricas.",
            );
          }
          return;
        }

        if (!controller.signal.aborted) {
          setMetrics(data.metrics);
          lastRequestUrl.current = requestUrl;
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("Nao foi possivel carregar metricas do dashboard.");
        }
      } finally {
        if (!controller.signal.aborted && !silent) {
          setLoading(false);
        }
      }
    },
    [requestUrl],
  );

  useEffect(() => {
    void fetchMetrics({ silent: false, force: true });
    return () => {
      if (activeRequest.current) {
        activeRequest.current.abort();
      }
    };
  }, [fetchMetrics]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let debounceTimeout: number | null = null;

    const triggerRefresh = () => {
      if (debounceTimeout !== null) {
        window.clearTimeout(debounceTimeout);
      }
      debounceTimeout = window.setTimeout(() => {
        void fetchMetrics({ silent: true, force: true });
      }, 550);
    };

    const onStorage = (event: StorageEvent) => {
      if (!event.key || !REFRESH_EVENT_KEYS.has(event.key)) return;
      triggerRefresh();
    };

    window.addEventListener("storage", onStorage);
    REFRESH_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, triggerRefresh);
    });

    return () => {
      if (debounceTimeout !== null) {
        window.clearTimeout(debounceTimeout);
      }
      window.removeEventListener("storage", onStorage);
      REFRESH_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, triggerRefresh);
      });
    };
  }, [fetchMetrics]);

  const refresh = useCallback(() => {
    void fetchMetrics({ silent: false, force: true });
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


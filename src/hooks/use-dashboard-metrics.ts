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


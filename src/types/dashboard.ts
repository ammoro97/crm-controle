export type PresetPeriodo = "max" | "today" | "yesterday" | "3d" | "7d" | "15d" | "30d" | "custom";

export type DashboardFilters = {
  periodo: PresetPeriodo;
  from?: string;
  to?: string;
  vendedorId?: string;
};

export type DashboardMetrics = {
  funnels: {
    absoluto: {
      ligacoes: number;
      atendidas: number;
      decisor: number;
      agendamentos: number;
      compras: number;
    };
    conversao: {
      atendidasPercentual: number;
      decisorPercentual: number;
      agendamentosPercentual: number;
      comprasPercentual: number;
    };
  };
  cards: {
    acionamentoBase: number;
    faturamento: number;
    vendasRealizadas: number;
    leadDesqualificado: number;
    followUpsPendentes: number;
    conversaoLigacao: number;
    taxaContatoDecisor: number;
    agendamentosPorLigacoes: number;
    taxaSemInteresse: number;
    percentualAtendimento: number;
    percentualCpc: number;
    noShow: number;
  };
};

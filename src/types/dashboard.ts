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
    percentualAtendimento: number;
    percentualCpc: number;
    noShow: number;
  };
};

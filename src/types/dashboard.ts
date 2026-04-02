export type DashboardMetrics = {
  funnel: {
    ligacoes: number;
    atendidas: number;
    decisor: number;
    agendamentos: number;
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


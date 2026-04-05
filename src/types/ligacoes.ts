export type StartCallInput = {
  leadId: string;
  numero: string;
  sessionId?: string;
  nome?: string;
  empresa?: string;
  responsavelId?: string;
  atendenteNome?: string;
};

export type ResolvedCallContext = {
  userId: string;
  ramal: string;
  numero: string;
  leadId: string;
  sessionId: string | null;
  nome: string;
  empresa: string;
  responsavelId: string | null;
  atendenteNome: string | null;
};

export type Api4StartCallPayload = {
  numero: string;
  ramal: string;
};

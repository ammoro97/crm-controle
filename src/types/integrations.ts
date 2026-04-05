export type StatusIntegracao = "ativo" | "inativo" | "erro";

export interface Api4Integracao {
  id: string;
  nome: string;
  ramal: string;
  gateway: string | null;
  token: string | null;
  status: StatusIntegracao;
  responsavelId: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface WebhookEntradaConfig {
  endpoint: string;
  status: "ativo" | "inativo";
  ultimoEventoRecebido: string | null;
}

export interface WebhookSaidaConfig {
  urlExterna: string;
  metodoHttp: "POST" | "PUT";
  segredo: string | null;
  status: "configurado" | "nao_configurado";
}

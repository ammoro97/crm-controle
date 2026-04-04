import { PostCallResultOption } from "@/lib/post-call-flow";

export type FinalizacaoTipo = "NAO_CONECTOU" | "PROBLEMA_BASE" | "CONECTOU";
export type FinalizacaoResultado = "POSITIVO" | "NEGATIVO" | "NEUTRO";

export type FinalizacaoClassification = {
  conectado: boolean;
  tipo: FinalizacaoTipo;
  resultado?: FinalizacaoResultado;
};

const FINALIZACAO_CLASSIFICATION_MAP: Record<PostCallResultOption | "Nao atendeu", FinalizacaoClassification> = {
  "Nao atendeu": { conectado: false, tipo: "NAO_CONECTOU" },
  "Caixa postal": { conectado: false, tipo: "NAO_CONECTOU" },
  "Ligacao caiu": { conectado: false, tipo: "NAO_CONECTOU" },
  "Ligacao muda": { conectado: false, tipo: "NAO_CONECTOU" },
  "Numero invalido": { conectado: false, tipo: "PROBLEMA_BASE" },
  "Pessoa nao conhece": { conectado: false, tipo: "PROBLEMA_BASE" },
  "Falou com cliente": { conectado: true, tipo: "CONECTOU" },
  "Falou com secretaria": { conectado: true, tipo: "CONECTOU", resultado: "NEUTRO" },
};

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function getFinalizacaoClassification(finalizacao: string): FinalizacaoClassification | null {
  const key = normalize(finalizacao);
  const entry = Object.entries(FINALIZACAO_CLASSIFICATION_MAP).find(([label]) => normalize(label) === key)?.[1];
  return entry || null;
}

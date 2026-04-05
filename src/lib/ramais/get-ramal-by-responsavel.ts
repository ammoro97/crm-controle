import { listApi4ComIntegracoes } from "@/lib/api4com-config-store";

type RamalStatus = "ativo" | "inativo" | "erro";

export type RamalByResponsavel = {
  integrationId: string;
  nome: string;
  ramal: string;
  gateway: string | null;
  token: string | null;
  status: RamalStatus;
  responsavelId: string | null;
};

export class ResponsavelRamalError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ResponsavelRamalError";
    this.status = status;
    this.code = code;
  }
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export async function getRamalByResponsavelId(responsavelId: string): Promise<RamalByResponsavel> {
  const targetResponsavelId = normalizeText(responsavelId);
  if (!targetResponsavelId) {
    throw new ResponsavelRamalError(409, "RESPONSAVEL_RAMAL_ID_REQUIRED", "Responsavel nao informado para buscar ramal.");
  }

  const integrations = await listApi4ComIntegracoes();
  const linked = integrations.filter((item) => normalizeText(item.responsavelId) === targetResponsavelId);

  if (linked.length === 0) {
    throw new ResponsavelRamalError(
      409,
      "RESPONSAVEL_RAMAL_NOT_LINKED",
      "O Responsavel vinculado ao usuario nao possui ramal cadastrado.",
    );
  }

  const active = linked.filter((item) => item.status === "ativo");
  if (active.length > 1) {
    throw new ResponsavelRamalError(
      409,
      "RESPONSAVEL_RAMAL_CONFLICT",
      "Conflito: existe mais de um ramal ativo vinculado ao mesmo Responsavel.",
    );
  }
  if (active.length === 0) {
    throw new ResponsavelRamalError(
      409,
      "RESPONSAVEL_RAMAL_INACTIVE",
      "O ramal vinculado ao Responsavel esta inativo.",
    );
  }

  const selected = active[0];
  const ramal = normalizeText(selected.ramal);
  if (!ramal) {
    throw new ResponsavelRamalError(
      409,
      "RESPONSAVEL_RAMAL_INVALID",
      "O ramal vinculado ao Responsavel esta invalido.",
    );
  }

  return {
    integrationId: selected.id,
    nome: selected.nome,
    ramal,
    gateway: selected.gateway || null,
    token: selected.token || null,
    status: selected.status,
    responsavelId: selected.responsavelId || null,
  };
}

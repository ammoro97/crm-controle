import {
  resolveResponsavelByAuthUser,
  ResponsavelByAuthError,
} from "@/lib/responsaveis/get-responsavel-by-auth-user";
import { getRamalByResponsavelId, ResponsavelRamalError } from "@/lib/ramais/get-ramal-by-responsavel";

export type ResolvedTelefoniaContext = {
  authUserId: string;
  responsavelId: string;
  responsavelNome: string;
  responsavelEmail: string | null;
  ramal: string;
  integrationId: string;
  gateway: string | null;
  token: string | null;
};

export class ResolveCallContextError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ResolveCallContextError";
    this.status = status;
    this.code = code;
  }
}

type ResolveCallContextInput = {
  authUserId: string;
  authEmail?: string | null;
};

export async function resolveCallContext(input: ResolveCallContextInput): Promise<ResolvedTelefoniaContext> {
  try {
    const responsavel = await resolveResponsavelByAuthUser({
      authUserId: input.authUserId,
      authEmail: input.authEmail,
    });

    const ramal = await getRamalByResponsavelId(responsavel.id);
    return {
      authUserId: input.authUserId,
      responsavelId: responsavel.id,
      responsavelNome: responsavel.nome,
      responsavelEmail: responsavel.emailLogin,
      ramal: ramal.ramal,
      integrationId: ramal.integrationId,
      gateway: ramal.gateway,
      token: ramal.token,
    };
  } catch (error) {
    if (error instanceof ResponsavelByAuthError || error instanceof ResponsavelRamalError) {
      throw new ResolveCallContextError(error.status, error.code, error.message);
    }
    throw new ResolveCallContextError(
      500,
      "CALL_CONTEXT_RESOLVE_FAILED",
      "Nao foi possivel resolver o contexto de telefonia do usuario autenticado.",
    );
  }
}

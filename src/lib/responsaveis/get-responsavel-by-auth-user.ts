import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { findAuthUserByEmail } from "@/lib/auth/list-auth-users";
import type { ResolvedResponsavelByAuth, ResponsavelVinculoOption } from "@/types/responsaveis";

const RESPONSAVEIS_TABLE = "crm_responsaveis";

type ResponsavelRow = {
  id: string;
  nome: string;
  email: string | null;
  auth_user_id?: string | null;
};

type ResponsaveisQueryResult = {
  rows: ResponsavelRow[];
  hasAuthUserIdColumn: boolean;
};

export class ResponsavelByAuthError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ResponsavelByAuthError";
    this.status = status;
    this.code = code;
  }
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function isMissingAuthUserIdColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = normalizeText(error?.code);
  const message = normalizeText(error?.message).toLowerCase();
  return code === "42703" || message.includes("auth_user_id");
}

function isInvalidUuidInputError(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = normalizeText(error?.code);
  const message = normalizeText(error?.message).toLowerCase();
  return code === "22P02" || message.includes("invalid input syntax for type uuid");
}

function toResponsavelRow(raw: Record<string, unknown>): ResponsavelRow | null {
  const id = normalizeText(raw.id);
  const nome = normalizeText(raw.nome);
  if (!id || !nome) return null;

  const email = normalizeEmail(raw.email) || null;
  const authUserId = normalizeText(raw.auth_user_id) || null;

  return {
    id,
    nome,
    email,
    auth_user_id: authUserId,
  };
}

async function queryResponsaveis(): Promise<ResponsaveisQueryResult> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new ResponsavelByAuthError(500, "RESPONSAVEL_ADMIN_UNAVAILABLE", "Supabase admin indisponivel.");
  }

  const selectWithAuth = "id,nome,email,auth_user_id";
  const selectLegacy = "id,nome,email";

  let hasAuthUserIdColumn = true;
  let data: unknown[] | null = null;

  const withAuth = await admin.from(RESPONSAVEIS_TABLE).select(selectWithAuth).order("nome", { ascending: true });
  if (withAuth.error && isMissingAuthUserIdColumn(withAuth.error)) {
    hasAuthUserIdColumn = false;
    const legacy = await admin.from(RESPONSAVEIS_TABLE).select(selectLegacy).order("nome", { ascending: true });
    if (legacy.error) {
      throw new ResponsavelByAuthError(
        500,
        "RESPONSAVEL_QUERY_FAILED",
        legacy.error.message || "Nao foi possivel carregar responsaveis.",
      );
    }
    data = Array.isArray(legacy.data) ? (legacy.data as unknown[]) : [];
  } else if (withAuth.error) {
    throw new ResponsavelByAuthError(
      500,
      "RESPONSAVEL_QUERY_FAILED",
      withAuth.error.message || "Nao foi possivel carregar responsaveis.",
    );
  } else {
    data = Array.isArray(withAuth.data) ? (withAuth.data as unknown[]) : [];
  }

  const rows = data
    .map((item) => (item && typeof item === "object" ? toResponsavelRow(item as Record<string, unknown>) : null))
    .filter((item): item is ResponsavelRow => Boolean(item));

  return {
    rows,
    hasAuthUserIdColumn,
  };
}

export async function listResponsaveisForVinculo(): Promise<ResponsavelVinculoOption[]> {
  const { rows } = await queryResponsaveis();
  return rows.map((row) => {
    const authUserId = normalizeText(row.auth_user_id) || null;
    return {
      id: row.id,
      nome: row.nome,
      emailLogin: row.email || null,
      authUserId,
      authLinked: Boolean(authUserId),
    };
  });
}

type ResolveResponsavelByAuthInput = {
  authUserId: string;
  authEmail?: string | null;
};

export async function resolveResponsavelByAuthUser(
  input: ResolveResponsavelByAuthInput,
): Promise<ResolvedResponsavelByAuth> {
  const authUserId = normalizeText(input.authUserId);
  const authEmail = normalizeEmail(input.authEmail);
  const authUserByEmail = authEmail ? await findAuthUserByEmail(authEmail) : null;
  const authUserIdFromEmail = normalizeText(authUserByEmail?.id);
  const authUserIdCandidates = new Set<string>([authUserId, authUserIdFromEmail].filter(Boolean));

  if (!authUserId) {
    throw new ResponsavelByAuthError(401, "RESPONSAVEL_AUTH_USER_MISSING", "Usuario autenticado nao encontrado.");
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new ResponsavelByAuthError(500, "RESPONSAVEL_ADMIN_UNAVAILABLE", "Supabase admin indisponivel.");
  }

  const { rows, hasAuthUserIdColumn } = await queryResponsaveis();

  if (hasAuthUserIdColumn) {
    const byAuth = rows.filter((row) => authUserIdCandidates.has(normalizeText(row.auth_user_id)));
    if (byAuth.length > 1) {
      throw new ResponsavelByAuthError(
        409,
        "RESPONSAVEL_AUTH_CONFLICT",
        "Conflito: mais de um responsavel esta vinculado ao mesmo usuario autenticado.",
      );
    }
    if (byAuth.length === 1) {
      const row = byAuth[0];
      const rowAuthUserId = normalizeText(row.auth_user_id) || null;
      return {
        id: row.id,
        nome: row.nome,
        emailLogin: row.email || null,
        authUserId: rowAuthUserId,
        linkStatus: "linked",
      };
    }
  }

  if (!authEmail) {
    throw new ResponsavelByAuthError(
      409,
      "RESPONSAVEL_AUTH_EMAIL_MISSING",
      "Usuario autenticado sem e-mail valido para correlacao com Responsavel.",
    );
  }

  const byEmail = rows.filter((row) => normalizeEmail(row.email) === authEmail);
  if (byEmail.length === 0) {
    throw new ResponsavelByAuthError(
      409,
      "RESPONSAVEL_AUTH_NOT_LINKED",
      "Usuario autenticado sem Responsavel vinculado. Configure em Configuracoes > Responsaveis.",
    );
  }
  if (byEmail.length > 1) {
    throw new ResponsavelByAuthError(
      409,
      "RESPONSAVEL_AUTH_DUPLICATE_EMAIL",
      "Conflito: existe mais de um Responsavel com o mesmo e-mail de login.",
    );
  }

  const matched = byEmail[0];
  const linkedAuthUserId = normalizeText(matched.auth_user_id);
  if (linkedAuthUserId && !authUserIdCandidates.has(linkedAuthUserId)) {
    throw new ResponsavelByAuthError(
      409,
      "RESPONSAVEL_AUTH_LINKED_TO_OTHER_USER",
      "Este Responsavel ja esta vinculado a outro usuario autenticado.",
    );
  }

  let resolvedAuthUserId: string | null = linkedAuthUserId || null;

  if (hasAuthUserIdColumn && !linkedAuthUserId) {
    const authUserIdToPersist = authUserIdFromEmail || authUserId;
    const { error } = await admin
      .from(RESPONSAVEIS_TABLE)
      .update({ auth_user_id: authUserIdToPersist })
      .eq("id", matched.id)
      .is("auth_user_id", null);

    if (error) {
      const errorCode = normalizeText(error.code);
      if (errorCode === "23505") {
        throw new ResponsavelByAuthError(
          409,
          "RESPONSAVEL_AUTH_UNIQUE_CONFLICT",
          "Conflito ao vincular Responsavel ao usuario autenticado.",
        );
      }
      if (isInvalidUuidInputError(error)) {
        // Compatibilidade: alguns ambientes possuem auth_user_id como UUID
        // enquanto o auth local usa IDs no formato USR-*. Nesses casos,
        // seguimos via fallback por e-mail sem bloquear o fluxo de ligação.
        resolvedAuthUserId = null;
      } else {
        throw new ResponsavelByAuthError(
          500,
          "RESPONSAVEL_AUTH_LINK_UPDATE_FAILED",
          error.message || "Nao foi possivel vincular usuario autenticado ao Responsavel.",
        );
      }
    } else {
      resolvedAuthUserId = authUserIdToPersist;
    }
  }

  return {
    id: matched.id,
    nome: matched.nome,
    emailLogin: matched.email || null,
    authUserId: hasAuthUserIdColumn ? resolvedAuthUserId : null,
    linkStatus: resolvedAuthUserId ? "linked" : "email_fallback",
  };
}

export async function syncResponsavelAuthLinkById(responsavelId: string): Promise<{
  responsavelId: string;
  authUserId: string | null;
  linked: boolean;
}> {
  const targetId = normalizeText(responsavelId);
  if (!targetId) {
    throw new ResponsavelByAuthError(400, "RESPONSAVEL_ID_REQUIRED", "Informe o id do Responsavel.");
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new ResponsavelByAuthError(500, "RESPONSAVEL_ADMIN_UNAVAILABLE", "Supabase admin indisponivel.");
  }

  const { rows, hasAuthUserIdColumn } = await queryResponsaveis();
  const current = rows.find((row) => row.id === targetId);
  if (!current) {
    throw new ResponsavelByAuthError(404, "RESPONSAVEL_NOT_FOUND", "Responsavel nao encontrado.");
  }

  if (!hasAuthUserIdColumn) {
    return {
      responsavelId: current.id,
      authUserId: null,
      linked: false,
    };
  }

  const email = normalizeEmail(current.email);
  if (!email) {
    await admin.from(RESPONSAVEIS_TABLE).update({ auth_user_id: null }).eq("id", current.id);
    return {
      responsavelId: current.id,
      authUserId: null,
      linked: false,
    };
  }

  const authUser = await findAuthUserByEmail(email);
  if (!authUser) {
    await admin.from(RESPONSAVEIS_TABLE).update({ auth_user_id: null }).eq("id", current.id);
    return {
      responsavelId: current.id,
      authUserId: null,
      linked: false,
    };
  }

  const currentAuthUserId = normalizeText(current.auth_user_id);
  if (currentAuthUserId === authUser.id) {
    return {
      responsavelId: current.id,
      authUserId: authUser.id,
      linked: true,
    };
  }

  const { error } = await admin
    .from(RESPONSAVEIS_TABLE)
    .update({ auth_user_id: authUser.id })
    .eq("id", current.id);

  if (error) {
    const errorCode = normalizeText(error.code);
    if (errorCode === "23505") {
      throw new ResponsavelByAuthError(
        409,
        "RESPONSAVEL_AUTH_UNIQUE_CONFLICT",
        "Este usuario autenticado ja esta vinculado a outro Responsavel.",
      );
    }
    throw new ResponsavelByAuthError(
      500,
      "RESPONSAVEL_AUTH_SYNC_FAILED",
      error.message || "Nao foi possivel sincronizar vinculo do Responsavel com o login.",
    );
  }

  return {
    responsavelId: current.id,
    authUserId: authUser.id,
    linked: true,
  };
}

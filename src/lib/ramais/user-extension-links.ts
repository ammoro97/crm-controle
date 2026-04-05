import { getSupabaseAdmin } from "@/lib/supabase-admin";

const USER_EXTENSIONS_TABLE = "user_extensions";

export type ActiveUserExtensionLink = {
  id: string;
  userId: string;
  ramal: string;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
};

export class UserExtensionLinkError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "UserExtensionLinkError";
    this.status = status;
    this.code = code;
  }
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function parseLink(row: Record<string, unknown>): ActiveUserExtensionLink | null {
  const id = normalizeText(row.id);
  const userId = normalizeText(row.user_id);
  const ramal = normalizeText(row.ramal);
  if (!id || !userId || !ramal) return null;

  return {
    id,
    userId,
    ramal,
    ativo: Boolean(row.ativo),
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at),
  };
}

async function listActiveRaw() {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new UserExtensionLinkError(500, "USER_EXTENSION_ADMIN_UNAVAILABLE", "Supabase admin indisponivel.");
  }

  const { data, error } = await admin
    .from(USER_EXTENSIONS_TABLE)
    .select("id,user_id,ramal,ativo,created_at,updated_at")
    .eq("ativo", true)
    .order("updated_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") {
      throw new UserExtensionLinkError(
        500,
        "USER_EXTENSION_TABLE_MISSING",
        "Tabela user_extensions nao encontrada no banco.",
      );
    }
    throw new UserExtensionLinkError(
      500,
      "USER_EXTENSION_LIST_FAILED",
      error.message || "Nao foi possivel listar vinculos de ramal.",
    );
  }

  if (!Array.isArray(data)) return [];
  return data as Record<string, unknown>[];
}

export async function listActiveUserExtensionLinks(): Promise<ActiveUserExtensionLink[]> {
  const rows = await listActiveRaw();
  return rows
    .map((row) => parseLink(row))
    .filter((row): row is ActiveUserExtensionLink => Boolean(row));
}

export async function getActiveUserExtensionLinkByRamal(ramal: string): Promise<ActiveUserExtensionLink | null> {
  const normalizedRamal = normalizeText(ramal);
  if (!normalizedRamal) return null;
  const rows = await listActiveRaw();
  const row = rows.find((item) => normalizeText(item.ramal) === normalizedRamal);
  if (!row) return null;
  return parseLink(row);
}

export async function getActiveUserExtensionLinkByUser(userId: string): Promise<ActiveUserExtensionLink | null> {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) return null;
  const rows = await listActiveRaw();
  const row = rows.find((item) => normalizeText(item.user_id) === normalizedUserId);
  if (!row) return null;
  return parseLink(row);
}

export async function clearUserExtensionLinkByRamal(ramal: string): Promise<void> {
  const normalizedRamal = normalizeText(ramal);
  if (!normalizedRamal) return;

  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new UserExtensionLinkError(500, "USER_EXTENSION_ADMIN_UNAVAILABLE", "Supabase admin indisponivel.");
  }

  const { error } = await admin
    .from(USER_EXTENSIONS_TABLE)
    .update({
      ativo: false,
      updated_at: new Date().toISOString(),
    })
    .eq("ramal", normalizedRamal)
    .eq("ativo", true);

  if (error && error.code !== "42P01") {
    throw new UserExtensionLinkError(
      500,
      "USER_EXTENSION_CLEAR_FAILED",
      error.message || "Nao foi possivel remover vinculo do ramal.",
    );
  }
}

export async function assignUserExtensionLink(input: {
  userId: string;
  ramal: string;
}): Promise<void> {
  const normalizedUserId = normalizeText(input.userId);
  const normalizedRamal = normalizeText(input.ramal);
  if (!normalizedUserId || !normalizedRamal) {
    throw new UserExtensionLinkError(400, "USER_EXTENSION_INVALID_INPUT", "Usuario e ramal sao obrigatorios.");
  }

  const byUser = await getActiveUserExtensionLinkByUser(normalizedUserId);
  if (byUser && byUser.ramal !== normalizedRamal) {
    throw new UserExtensionLinkError(
      409,
      "USER_EXTENSION_USER_ALREADY_LINKED",
      `Este usuario ja esta vinculado ao ramal ${byUser.ramal}.`,
    );
  }

  const byRamal = await getActiveUserExtensionLinkByRamal(normalizedRamal);
  if (byRamal && byRamal.userId !== normalizedUserId) {
    throw new UserExtensionLinkError(
      409,
      "USER_EXTENSION_RAMAL_ALREADY_LINKED",
      "Este ramal ja esta vinculado a outro usuario.",
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new UserExtensionLinkError(500, "USER_EXTENSION_ADMIN_UNAVAILABLE", "Supabase admin indisponivel.");
  }

  const nowIso = new Date().toISOString();
  const { data: existingRows, error: existingError } = await admin
    .from(USER_EXTENSIONS_TABLE)
    .select("id,user_id,ramal,ativo")
    .eq("user_id", normalizedUserId)
    .eq("ramal", normalizedRamal)
    .limit(1);

  if (existingError && existingError.code !== "42P01") {
    throw new UserExtensionLinkError(
      500,
      "USER_EXTENSION_LOOKUP_FAILED",
      existingError.message || "Falha ao validar vinculo de ramal.",
    );
  }

  const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;
  if (existing && normalizeText(existing.id)) {
    const { error: updateError } = await admin
      .from(USER_EXTENSIONS_TABLE)
      .update({
        ativo: true,
        updated_at: nowIso,
      })
      .eq("id", normalizeText(existing.id));

    if (updateError) {
      throw new UserExtensionLinkError(
        500,
        "USER_EXTENSION_UPDATE_FAILED",
        updateError.message || "Nao foi possivel atualizar vinculo de ramal.",
      );
    }
    return;
  }

  const { error: insertError } = await admin.from(USER_EXTENSIONS_TABLE).insert({
    user_id: normalizedUserId,
    ramal: normalizedRamal,
    ativo: true,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError) {
    throw new UserExtensionLinkError(
      500,
      "USER_EXTENSION_INSERT_FAILED",
      insertError.message || "Nao foi possivel salvar vinculo de ramal.",
    );
  }
}

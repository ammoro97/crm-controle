import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { UserExtension } from "@/types/ramais";

const USER_EXTENSIONS_TABLE = "user_extensions";

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeRow(row: Record<string, unknown>): UserExtension | null {
  const id = normalizeText(row.id);
  const userId = normalizeText(row.user_id);
  const ramal = normalizeText(row.ramal);
  if (!id || !userId || !ramal) return null;

  const createdAt = normalizeText(row.created_at);
  const updatedAt = normalizeText(row.updated_at);

  return {
    id,
    user_id: userId,
    ramal,
    ativo: Boolean(row.ativo),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export async function getUserExtension(userId: string): Promise<UserExtension | null> {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) return null;

  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_ADMIN_UNAVAILABLE");
  }

  const { data, error } = await admin
    .from(USER_EXTENSIONS_TABLE)
    .select("id,user_id,ramal,ativo,created_at,updated_at")
    .eq("user_id", normalizedUserId)
    .eq("ativo", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      throw new Error("USER_EXTENSIONS_TABLE_MISSING");
    }
    throw new Error(error.message || "USER_EXTENSION_LOOKUP_FAILED");
  }

  if (!data) return null;
  return normalizeRow(data as Record<string, unknown>);
}

export async function assertUserHasActiveExtension(userId: string): Promise<UserExtension> {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    throw new Error("USER_EXTENSION_USER_ID_REQUIRED");
  }

  const active = await getUserExtension(normalizedUserId);
  if (active) return active;

  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_ADMIN_UNAVAILABLE");
  }

  const { data, error } = await admin
    .from(USER_EXTENSIONS_TABLE)
    .select("id,user_id,ramal,ativo,created_at,updated_at")
    .eq("user_id", normalizedUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      throw new Error("USER_EXTENSIONS_TABLE_MISSING");
    }
    throw new Error(error.message || "USER_EXTENSION_LOOKUP_FAILED");
  }

  if (!data) {
    throw new Error("USER_EXTENSION_NOT_CONFIGURED");
  }

  const parsed = normalizeRow(data as Record<string, unknown>);
  if (!parsed) {
    throw new Error("USER_EXTENSION_INVALID");
  }

  if (!parsed.ativo) {
    throw new Error("USER_EXTENSION_INACTIVE");
  }

  return parsed;
}

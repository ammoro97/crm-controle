import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type AuthUserOption = {
  id: string;
  email: string;
  nome: string;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function resolveUserName(user: Record<string, unknown>): string {
  const userMetadata =
    user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : {};
  const appMetadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? (user.app_metadata as Record<string, unknown>)
      : {};

  const candidates = [
    userMetadata.full_name,
    userMetadata.name,
    appMetadata.full_name,
    appMetadata.name,
    user.email,
  ];
  const resolved = candidates.find((candidate) => normalizeText(candidate));
  return normalizeText(resolved) || "Usuario";
}

export async function listAuthUsers(): Promise<AuthUserOption[]> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_ADMIN_UNAVAILABLE");
  }

  const perPage = 200;
  const users: AuthUserOption[] = [];
  let page = 1;
  let keepPaging = true;

  while (keepPaging) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(error.message || "AUTH_USERS_LIST_FAILED");
    }

    const currentPageUsers = Array.isArray(data?.users) ? data.users : [];
    for (const item of currentPageUsers) {
      const id = normalizeText(item.id);
      const email = normalizeText(item.email);
      if (!id || !email) continue;
      users.push({
        id,
        email,
        nome: resolveUserName(item as unknown as Record<string, unknown>),
      });
    }

    if (currentPageUsers.length < perPage) {
      keepPaging = false;
    } else {
      page += 1;
      if (page > 20) keepPaging = false;
    }
  }

  users.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return users;
}

export async function findAuthUserByEmail(email: string): Promise<AuthUserOption | null> {
  const normalizedEmail = normalizeText(email).toLowerCase();
  if (!normalizedEmail) return null;
  const users = await listAuthUsers();
  return users.find((user) => normalizeText(user.email).toLowerCase() === normalizedEmail) || null;
}

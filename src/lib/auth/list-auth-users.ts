import { getUsersPublic } from "@/lib/auth-store";

export type AuthUserOption = {
  id: string;
  email: string;
  nome: string;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export async function listAuthUsers(): Promise<AuthUserOption[]> {
  const users = await getUsersPublic();
  return users
    .map((user) => ({
      id: normalizeText(user.id),
      email: normalizeText(user.email),
      nome: normalizeText(user.nome) || normalizeText(user.email) || "Usuario",
    }))
    .filter((user) => Boolean(user.id && user.email))
    .sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));
}

export async function findAuthUserByEmail(email: string): Promise<AuthUserOption | null> {
  const normalizedEmail = normalizeText(email).toLowerCase();
  if (!normalizedEmail) return null;

  const users = await listAuthUsers();
  return users.find((item) => item.email.toLowerCase() === normalizedEmail) || null;
}

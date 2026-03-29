"use client";

import { PublicUser } from "@/types/auth";
import { getResponsavelByEmail, getResponsavelByEmailSnapshot, ResponsavelRecord } from "@/lib/responsaveis-store";

export type ResolvedResponsavel = {
  linked: boolean;
  email: string;
  responsavel: ResponsavelRecord | null;
  error?: string;
};

export function normalizeEmailForMatch(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

export function resolveResponsavelByEmail(email?: string | null): ResolvedResponsavel {
  const normalizedEmail = normalizeEmailForMatch(email);
  if (!normalizedEmail) {
    return {
      linked: false,
      email: "",
      responsavel: null,
      error: "Usuario autenticado sem e-mail valido.",
    };
  }

  const responsavel = getResponsavelByEmailSnapshot(normalizedEmail);
  if (!responsavel) {
    return {
      linked: false,
      email: normalizedEmail,
      responsavel: null,
      error:
        "Seu usuario ainda nao esta vinculado a um responsavel no CRM. Cadastre esse e-mail em Configuracoes > Responsaveis.",
    };
  }

  return {
    linked: true,
    email: normalizedEmail,
    responsavel,
  };
}

export function resolveResponsavelFromUser(user?: Pick<PublicUser, "email"> | null): ResolvedResponsavel {
  return resolveResponsavelByEmail(user?.email);
}

export async function resolveResponsavelByEmailAsync(email?: string | null): Promise<ResolvedResponsavel> {
  const normalizedEmail = normalizeEmailForMatch(email);
  if (!normalizedEmail) {
    return {
      linked: false,
      email: "",
      responsavel: null,
      error: "Usuario autenticado sem e-mail valido.",
    };
  }

  const responsavel = await getResponsavelByEmail(normalizedEmail);
  if (!responsavel) {
    return {
      linked: false,
      email: normalizedEmail,
      responsavel: null,
      error:
        "Seu usuario ainda nao esta vinculado a um responsavel no CRM. Cadastre esse e-mail em Configuracoes > Responsaveis.",
    };
  }

  return {
    linked: true,
    email: normalizedEmail,
    responsavel,
  };
}

export async function resolveResponsavelFromUserAsync(
  user?: Pick<PublicUser, "email"> | null,
): Promise<ResolvedResponsavel> {
  return resolveResponsavelByEmailAsync(user?.email);
}

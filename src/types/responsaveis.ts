export type ResponsavelAuthLinkStatus = "linked" | "email_fallback" | "unlinked";

export type ResponsavelVinculoOption = {
  id: string;
  nome: string;
  emailLogin: string | null;
  authUserId: string | null;
  authLinked: boolean;
};

export type ResolvedResponsavelByAuth = {
  id: string;
  nome: string;
  emailLogin: string | null;
  authUserId: string | null;
  linkStatus: ResponsavelAuthLinkStatus;
};

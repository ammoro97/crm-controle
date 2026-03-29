export type UserRecord = {
  id: string;
  nome: string;
  email: string;
  senhaHash: string;
  responsavelId: string;
};

export type PublicUser = {
  id: string;
  nome: string;
  email: string;
  responsavelId: string;
  responsavelVinculado: boolean;
};

export type AuthSessionRecord = {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { AuthSessionRecord, PublicUser, UserRecord } from "@/types/auth";
import { readDataFile, writeDataFile } from "./storage-paths";

const USERS_FILE = "users.json";
const SESSIONS_FILE = "auth-sessions.json";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

let usersCache: UserRecord[] | null = null;
let sessionsCache: AuthSessionRecord[] | null = null;

function toPublicUser(user: UserRecord): PublicUser {
  const responsavelId = String(user.responsavelId || "").trim();
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    responsavelId,
    responsavelVinculado: Boolean(responsavelId),
  };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function toDefaultNameFromEmail(email: string) {
  const localPart = normalizeEmail(email).split("@")[0] || "usuario";
  return localPart
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toResponsavelId(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function loadUsers(): Promise<UserRecord[]> {
  if (usersCache) return usersCache;
  const parsed = await readDataFile<UserRecord[]>(USERS_FILE, []);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    usersCache = [];
    return usersCache;
  }
  usersCache = parsed
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id),
      nome: String(item.nome),
      email: normalizeEmail(String(item.email)),
      senhaHash: String(item.senhaHash),
      responsavelId: String(item.responsavelId || toResponsavelId(String(item.nome))),
    }));
  return usersCache;
}

async function saveUsers(next: UserRecord[]) {
  usersCache = next;
  await writeDataFile(USERS_FILE, next);
}

async function loadSessions(): Promise<AuthSessionRecord[]> {
  if (sessionsCache) return sessionsCache;
  const parsed = await readDataFile<AuthSessionRecord[]>(SESSIONS_FILE, []);
  sessionsCache = Array.isArray(parsed) ? parsed : [];
  return sessionsCache;
}

async function saveSessions(next: AuthSessionRecord[]) {
  sessionsCache = next;
  await writeDataFile(SESSIONS_FILE, next);
}

function removeExpiredSessions(sessions: AuthSessionRecord[]) {
  const now = Date.now();
  return sessions.filter((session) => Date.parse(session.expiresAt) > now);
}

export async function getUsersPublic(): Promise<PublicUser[]> {
  const users = await loadUsers();
  return users.map(toPublicUser);
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const users = await loadUsers();
  const normalized = normalizeEmail(email);
  return users.find((user) => normalizeEmail(user.email) === normalized) || null;
}

export async function registerUser(input: {
  email: string;
  password: string;
  nome?: string;
  responsavelId?: string;
}): Promise<{ success: true; user: PublicUser } | { success: false; message: string }> {
  const email = normalizeEmail(input.email);
  const password = String(input.password || "");

  if (!email) {
    return { success: false, message: "Informe um email valido." };
  }

  if (!password) {
    return { success: false, message: "Informe uma senha valida." };
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return { success: false, message: "Ja existe um usuario cadastrado com este email." };
  }

  const nome = String(input.nome || "").trim() || toDefaultNameFromEmail(email);
  const id = `USR-${crypto.randomUUID()}`;
  const senhaHash = await bcrypt.hash(password, 10);
  const responsavelId = String(input.responsavelId || "").trim() || toResponsavelId(`${nome}-${id.slice(-4)}`);

  const nextUser: UserRecord = {
    id,
    nome,
    email,
    senhaHash,
    responsavelId,
  };

  const users = await loadUsers();
  await saveUsers([nextUser, ...users]);
  return { success: true, user: toPublicUser(nextUser) };
}

export async function validateCredentials(email: string, password: string): Promise<PublicUser | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.senhaHash);
  if (!valid) return null;
  return toPublicUser(user);
}

export async function createSession(userId: string): Promise<string> {
  const sessions = removeExpiredSessions(await loadSessions());
  const token = crypto.randomUUID();
  const now = Date.now();
  const next: AuthSessionRecord = {
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  await saveSessions([next, ...sessions]);
  return token;
}

export async function getUserBySessionToken(token: string): Promise<PublicUser | null> {
  if (!token) return null;
  const sessions = removeExpiredSessions(await loadSessions());
  if (sessions.length !== (sessionsCache?.length || 0)) {
    await saveSessions(sessions);
  }
  const session = sessions.find((item) => item.token === token);
  if (!session) return null;
  const users = await loadUsers();
  const user = users.find((item) => item.id === session.userId);
  return user ? toPublicUser(user) : null;
}

export async function deleteSession(token: string) {
  if (!token) return;
  const sessions = await loadSessions();
  const next = sessions.filter((session) => session.token !== token);
  await saveSessions(next);
}

export async function ensureUserLinkedToResponsavel(userId: string, responsavelId: string) {
  const users = await loadUsers();
  const index = users.findIndex((item) => item.id === userId);
  if (index === -1) return;
  if (users[index].responsavelId === responsavelId) return;
  const next = [...users];
  next[index] = {
    ...next[index],
    responsavelId,
  };
  await saveUsers(next);
}

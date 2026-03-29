import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { AuthSessionRecord, PublicUser, UserRecord } from "@/types/auth";

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "auth-sessions.json");

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const DEFAULT_USER_EMAIL = "admin@crm.local";
const DEFAULT_USER_PASSWORD = "123456";

let usersCache: UserRecord[] | null = null;
let sessionsCache: AuthSessionRecord[] | null = null;

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    responsavelId: user.responsavelId,
  };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function toResponsavelId(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJSONFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSONFile<T>(filePath: string, value: T) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function bootstrapDefaultUser() {
  const id = "U-ADMIN-001";
  const nome = "Rafael";
  const responsavelId = toResponsavelId(nome);
  const senhaHash = await bcrypt.hash(DEFAULT_USER_PASSWORD, 10);
  const next: UserRecord[] = [
    {
      id,
      nome,
      email: DEFAULT_USER_EMAIL,
      senhaHash,
      responsavelId,
    },
  ];
  await writeJSONFile(USERS_FILE, next);
  return next;
}

async function loadUsers(): Promise<UserRecord[]> {
  if (usersCache) return usersCache;
  const parsed = await readJSONFile<UserRecord[]>(USERS_FILE, []);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    usersCache = await bootstrapDefaultUser();
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
  await writeJSONFile(USERS_FILE, next);
}

async function loadSessions(): Promise<AuthSessionRecord[]> {
  if (sessionsCache) return sessionsCache;
  const parsed = await readJSONFile<AuthSessionRecord[]>(SESSIONS_FILE, []);
  sessionsCache = Array.isArray(parsed) ? parsed : [];
  return sessionsCache;
}

async function saveSessions(next: AuthSessionRecord[]) {
  sessionsCache = next;
  await writeJSONFile(SESSIONS_FILE, next);
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

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { eq, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { db } from "@/db";
import { appUsers, authSessions } from "@/db/schema";

const scrypt = promisify(scryptCallback) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "fluxo_session";
const SESSION_DAYS = 30;
const KEY_LENGTH = 64;

export type SessionUser = { id: string; name: string; email: string };

/* ---------- Senhas ---------- */

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const derived = await scrypt(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/* ---------- Validação de entrada ---------- */

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ---------- Sessões ---------- */

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(authSessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  // Limpeza oportunista de sessões expiradas (barata e evita crescimento da tabela).
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function destroySessionByToken(token: string) {
  await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
}

/* ---------- Leitura do token da requisição ---------- */

/**
 * O token pode chegar de duas formas:
 *  1. Cabeçalho `Authorization: Bearer <token>` — caminho principal. Funciona em
 *     qualquer contexto, inclusive quando o app roda dentro de um iframe e o
 *     navegador bloqueia cookies de terceiros.
 *  2. Cookie HttpOnly — caminho secundário, para acesso direto pelo navegador.
 */
async function readBearerToken() {
  try {
    const headerStore = await headers();
    const authorization = headerStore.get("authorization");
    if (!authorization) return null;
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function readCookieToken() {
  try {
    const store = await cookies();
    return store.get(SESSION_COOKIE)?.value || null;
  } catch {
    return null;
  }
}

/** Tokens candidatos da requisição atual: cabeçalho tem prioridade, cookie é fallback. */
export async function getSessionTokens() {
  const tokens: string[] = [];
  const bearer = await readBearerToken();
  if (bearer) tokens.push(bearer);
  const cookieToken = await readCookieToken();
  if (cookieToken && !tokens.includes(cookieToken)) tokens.push(cookieToken);
  return tokens;
}

export async function getSessionUserFromToken(token: string): Promise<SessionUser | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db
    .select({
      sessionId: authSessions.id,
      expiresAt: authSessions.expiresAt,
      lastSeenAt: authSessions.lastSeenAt,
      userId: appUsers.id,
      name: appUsers.name,
      email: appUsers.email,
    })
    .from(authSessions)
    .innerJoin(appUsers, eq(authSessions.userId, appUsers.id))
    .where(eq(authSessions.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return null;

  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(authSessions).where(eq(authSessions.id, row.sessionId));
    return null;
  }

  // Atualiza "visto por último" no máximo uma vez por hora.
  if (Date.now() - row.lastSeenAt.getTime() > 3600000) {
    await db.update(authSessions).set({ lastSeenAt: new Date() }).where(eq(authSessions.id, row.sessionId));
  }

  return { id: row.userId, name: row.name, email: row.email };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  for (const token of await getSessionTokens()) {
    const user = await getSessionUserFromToken(token);
    if (user) return user;
  }
  return null;
}

/**
 * Autenticação explícita para operações do perfil. O token JSON só é enviado
 * por POST, nunca em URL, e recebe a mesma validação de hash/expiração real.
 * Se uma credencial explícita for inválida, não recorre ao cookie de outra conta.
 */
export async function getRequestSessionUser(request: Request, explicitToken?: unknown): Promise<SessionUser | null> {
  if (explicitToken !== undefined && explicitToken !== null) {
    return typeof explicitToken === "string"
      ? getSessionUserFromToken(explicitToken.trim())
      : null;
  }
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer\s+([A-Za-z0-9_-]{43})$/i.exec(authorization.trim());
    return match ? getSessionUserFromToken(match[1]) : null;
  }
  return getSessionUser();
}

/* ---------- Cookies ---------- */

export function isSecureRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function applySessionCookie(response: NextResponse, token: string, expiresAt: Date, secure: boolean) {
  // Configurações de cookies universais e ultra compatíveis.
  // Evitamos 'partitioned' e usamos 'lax' ou 'none' baseando-se no protocolo real.
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse, secure: boolean) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    path: "/",
    expires: new Date(0),
  });
}

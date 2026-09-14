import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ClockMode = "auto" | "simulated";

export type ClockFields = {
  clockMode: string | null;
  clockAnchorReal: Date | null;
  clockAnchorSim: Date | null;
  /** Fuso do navegador do usuário (convenção getTimezoneOffset: UTC−3 → 180). */
  clockTzOffset?: number | null;
};

export type ClockUser = {
  id: string;
} & ClockFields;

/**
 * Relógio central da plataforma.
 *
 * Toda a lógica de estudos deve perguntar "que horas são" a esta função em vez
 * de chamar `new Date()` diretamente. Dois modos:
 *
 *  - `auto` (padrão): acompanha a hora real do servidor;
 *  - `simulated`: o administrador definiu um ponto de partida; a partir daí o
 *    relógio continua andando normalmente (com offset), nunca "congelado".
 *
 * Segurança (expiração de login) usa a hora real de propósito — ver `auth.ts`.
 */
export function resolveNow(fields: ClockFields): Date {
  if (fields.clockMode === "simulated" && fields.clockAnchorReal && fields.clockAnchorSim) {
    const elapsed = Date.now() - fields.clockAnchorReal.getTime();
    return new Date(fields.clockAnchorSim.getTime() + elapsed);
  }
  return new Date();
}

export function currentClockMode(fields: ClockFields): ClockMode {
  return fields.clockMode === "simulated" ? "simulated" : "auto";
}

export function isSimulated(fields: ClockFields): boolean {
  return currentClockMode(fields) === "simulated";
}

export class ClockUpdateError extends Error {
  constructor(message: string, public readonly status: 400 | 403) {
    super(message);
    this.name = "ClockUpdateError";
  }
}

/** Limites razoáveis de fuso (±15 h) na convenção `getTimezoneOffset`. */
const TZ_OFFSET_LIMIT = 900;

/**
 * Aceita o offset vindo do cliente. `undefined`/`null` → fuso do servidor
 * (comportamento legado); tipo inválido ou inteiro fora da faixa → erro 400.
 */
export function normalizeTzOffset(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > TZ_OFFSET_LIMIT) {
    throw new ClockUpdateError("Fuso horário inválido. Recarregue a página e tente novamente.", 400);
  }
  return value;
}

/** Valida data/hora no fuso do usuário sem aceitar normalizações silenciosas. */
export function clockAnchorFor(
  targetDate: string,
  targetTime: string,
  tzOffsetMinutes: number = new Date().getTimezoneOffset(),
): { real: Date; sim: Date } {
  if (!Number.isInteger(tzOffsetMinutes) || Math.abs(tzOffsetMinutes) > TZ_OFFSET_LIMIT) {
    throw new ClockUpdateError("Fuso horário inválido. Recarregue a página e tente novamente.", 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(targetTime)) {
    throw new ClockUpdateError("Informe uma data e hora válidas.", 400);
  }
  const [year, month, day] = targetDate.split("-").map(Number);
  const [hour, minute] = targetTime.split(":").map(Number);
  // Parede de referência: os componentes escolhidos lidos como UTC. Serve tanto
  // para validar (Date.UTC normaliza datas inexistentes) quanto para calcular.
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    !Number.isFinite(wall.getTime()) || year < 1 ||
    wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day ||
    wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute
  ) {
    throw new ClockUpdateError("A data ou hora informada não existe. Confira os campos.", 400);
  }
  // Converte a parede do fuso do usuário para o instante real:
  // UTC = parede + offset (ex.: 15:00 com offset 180 (UTC−3) → 18:00Z).
  const sim = new Date(wall.getTime() + tzOffsetMinutes * 60000);
  // Esta âncora SEMPRE usa o relógio real. Nunca altera a expiração do login.
  return { real: new Date(), sim };
}

/**
 * Único caminho de escrita do relógio, usado tanto pelo perfil quanto pela API
 * legada de estudos. Valida a categoria no banco e altera só a conta autenticada.
 * Não escreve, exclui ou renova nenhuma sessão de autenticação.
 */
export async function updateUserClock(
  userId: string,
  studyDate: unknown,
  startTime: unknown,
  tzOffset?: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx.select({ role: appUsers.role })
      .from(appUsers).where(eq(appUsers.id, userId)).limit(1).for("update");
    if (!user || user.role !== "admin") {
      throw new ClockUpdateError("Apenas administradores podem simular data e hora.", 403);
    }
    if (typeof studyDate !== "string" || typeof startTime !== "string") {
      throw new ClockUpdateError("Informe a data e a hora para definir o relógio.", 400);
    }
    // O fuso informado pelo navegador é persistido mesmo no modo auto: os
    // registros de data/hora da plataforma passam a usar o fuso do usuário.
    const resolvedTz = normalizeTzOffset(tzOffset, new Date().getTimezoneOffset());
    const date = studyDate.trim();
    const time = startTime.trim();
    if (!date && !time) {
      await tx.update(appUsers).set({
        clockMode: "auto", clockAnchorReal: null, clockAnchorSim: null,
        clockTzOffset: resolvedTz, updatedAt: new Date(),
      }).where(eq(appUsers.id, userId));
      return;
    }
    if (!date || !time) {
      throw new ClockUpdateError("Preencha a data e a hora. Para restaurar, use Sincronizar.", 400);
    }
    const anchor = clockAnchorFor(date, time, resolvedTz);
    await tx.update(appUsers).set({
      clockMode: "simulated", clockAnchorReal: anchor.real, clockAnchorSim: anchor.sim,
      clockTzOffset: resolvedTz, updatedAt: anchor.real,
    }).where(eq(appUsers.id, userId));
  });
}

/** Retorna o usuário (com campos do relógio) pelo id. */
export async function loadClockUser(userId: string): Promise<ClockUser | null> {
  const [user] = await db
    .select({
      id: appUsers.id,
      clockMode: appUsers.clockMode,
      clockAnchorReal: appUsers.clockAnchorReal,
      clockAnchorSim: appUsers.clockAnchorSim,
      clockTzOffset: appUsers.clockTzOffset,
    })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return user ?? null;
}

/** Resolve o relógio atual de um usuário a partir do banco. */
export async function resolveUserNow(userId: string): Promise<Date> {
  const user = await loadClockUser(userId);
  if (!user) return new Date();
  return resolveNow(user);
}

/* ---------- Promoção de administradores ---------- */

export function adminEmailsFromEnv(): string[] {
  const raw = process.env.FLUXO_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return adminEmailsFromEnv().includes(normalized);
}

/** Total de contas no banco (usado para bootstrap do primeiro admin). */
export async function countUsers(): Promise<number> {
  const rows = await db.select({ id: appUsers.id }).from(appUsers);
  return rows.length;
}

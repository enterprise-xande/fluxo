import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ClockMode = "auto" | "simulated";

export type ClockFields = {
  clockMode: string | null;
  clockAnchorReal: Date | null;
  clockAnchorSim: Date | null;
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

/** Valida data/hora local do servidor sem aceitar normalizações silenciosas. */
export function clockAnchorFor(targetDate: string, targetTime: string): { real: Date; sim: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(targetTime)) {
    throw new ClockUpdateError("Informe uma data e hora válidas.", 400);
  }
  const [year, month, day] = targetDate.split("-").map(Number);
  const [hour, minute] = targetTime.split(":").map(Number);
  const sim = new Date(`${targetDate}T${targetTime}:00`);
  if (
    !Number.isFinite(sim.getTime()) || year < 1 ||
    sim.getFullYear() !== year || sim.getMonth() !== month - 1 || sim.getDate() !== day ||
    sim.getHours() !== hour || sim.getMinutes() !== minute
  ) {
    throw new ClockUpdateError("A data ou hora informada não existe. Confira os campos.", 400);
  }
  // Esta âncora SEMPRE usa o relógio real. Nunca altera a expiração do login.
  return { real: new Date(), sim };
}

/**
 * Único caminho de escrita do relógio, usado tanto pelo perfil quanto pela API
 * legada de estudos. Valida a categoria no banco e altera só a conta autenticada.
 * Não escreve, exclui ou renova nenhuma sessão de autenticação.
 */
export async function updateUserClock(userId: string, studyDate: unknown, startTime: unknown): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx.select({ role: appUsers.role })
      .from(appUsers).where(eq(appUsers.id, userId)).limit(1).for("update");
    if (!user || user.role !== "admin") {
      throw new ClockUpdateError("Apenas administradores podem simular data e hora.", 403);
    }
    if (typeof studyDate !== "string" || typeof startTime !== "string") {
      throw new ClockUpdateError("Informe a data e a hora para definir o relógio.", 400);
    }
    const date = studyDate.trim();
    const time = startTime.trim();
    if (!date && !time) {
      await tx.update(appUsers).set({
        clockMode: "auto", clockAnchorReal: null, clockAnchorSim: null, updatedAt: new Date(),
      }).where(eq(appUsers.id, userId));
      return;
    }
    if (!date || !time) {
      throw new ClockUpdateError("Preencha a data e a hora. Para restaurar, use Sincronizar.", 400);
    }
    const anchor = clockAnchorFor(date, time);
    await tx.update(appUsers).set({
      clockMode: "simulated", clockAnchorReal: anchor.real, clockAnchorSim: anchor.sim,
      updatedAt: anchor.real,
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

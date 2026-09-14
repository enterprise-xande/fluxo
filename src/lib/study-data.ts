import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  appUsers,
  cycleTopics,
  objectives,
  studyCycles,
  studySessions,
  tasks,
  topicSchedules,
  topics,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { currentClockMode, resolveNow, type ClockFields } from "@/lib/clock";

export const DEMO_ACCOUNT = {
  name: "Ana Martins",
  email: "ana@fluxo.local",
  password: "fluxo1234",
};
const TOPIC_COLORS = ["violet", "sky", "amber"];

function isoDate(value: Date, tzOffsetMinutes: number = value.getTimezoneOffset()) {
  // Parede no fuso indicado (convenção getTimezoneOffset: UTC−3 → 180).
  const local = new Date(value.getTime() - tzOffsetMinutes * 60000);
  return local.toISOString().slice(0, 10);
}

function dateOffset(days: number, now: Date, tzOffsetMinutes?: number) {
  const value = new Date(now.getTime());
  value.setDate(value.getDate() + days);
  return isoDate(value, tzOffsetMinutes);
}

function dateAgo(days: number, now: Date) {
  const value = new Date(now.getTime());
  value.setDate(value.getDate() - days);
  value.setHours(19, 30, 0, 0);
  return value;
}

function addDays(dateIso: string, days: number) {
  // Aritmética pura de calendário em espaço UTC: independe do fuso do servidor.
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function elapsedFor(cycle: { startDate: string; durationDays: number }, now: Date, tzOffsetMinutes = 0) {
  // Ancora o início ao meio-dia UTC e desloca o "agora" para o espaço de parede
  // do usuário — a contagem de dias vira exatamente à meia-noite DELE.
  const [year, month, day] = cycle.startDate.split("-").map(Number);
  const start = Date.UTC(year, month - 1, day, 12);
  return Math.max(1, Math.min(cycle.durationDays, Math.floor((now.getTime() + tzOffsetMinutes * 60000 - start) / 86400000) + 1));
}

/** Hora do relógio da plataforma para um usuário (máscara fina sobre resolveNow). */
function userNow(user: ClockFields): Date {
  return resolveNow(user);
}

/**
 * Garante que a conta de demonstração exista, tenha senha definida e
 * possua conteúdo inicial caso esteja vazia. Chamada apenas quando alguém
 * tenta entrar com o e-mail da conta demo.
 */
export async function ensureDemoAccount() {
  let [user] = await db.select().from(appUsers).where(eq(appUsers.email, DEMO_ACCOUNT.email)).limit(1);

  if (!user) {
    const passwordHash = await hashPassword(DEMO_ACCOUNT.password);
    [user] = await db
      .insert(appUsers)
      .values({ name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email, passwordHash, role: "admin" })
      .returning();
  } else {
    // Garante que o usuário de demonstração seja administrador
    if (!user.passwordHash || user.role !== "admin") {
      const passwordHash = user.passwordHash || (await hashPassword(DEMO_ACCOUNT.password));
      await db
        .update(appUsers)
        .set({ passwordHash, role: "admin", updatedAt: new Date() })
        .where(eq(appUsers.id, user.id));
      // atualiza objeto em memória
      user.role = "admin";
    }
  }

  const [anyTopic] = await db.select({ id: topics.id }).from(topics).where(eq(topics.userId, user.id)).limit(1);
  // Se a conta já tem temas (mesmo arquivados), preserva os dados atuais.
  if (!anyTopic) await seedDemoContent(user.id);
  return user;
}

async function seedDemoContent(userId: string) {
  const user = { id: userId };
  // O seed acontece uma única vez, antes de qualquer simulação de relógio.
  const now = new Date();

  const [network] = await db
    .insert(topics)
    .values({
      userId: user.id,
      name: "Redes de Distribuição Aérea",
      description: "Dimensionamento, estruturas e critérios de projeto.",
      color: "violet",
    })
    .returning();
  const [protection] = await db
    .insert(topics)
    .values({
      userId: user.id,
      name: "Proteção de Sistemas",
      description: "Coordenação e seletividade de proteções.",
      color: "sky",
    })
    .returning();
  const [machines] = await db
    .insert(topics)
    .values({
      userId: user.id,
      name: "Máquinas Elétricas",
      description: "Fundamentos, ensaios e aplicações.",
      color: "amber",
    })
    .returning();

  const [cycle] = await db
    .insert(studyCycles)
    .values({
      userId: user.id,
      name: "Redes de Distribuição",
      description: "Ciclo focado em projeto de redes aéreas e competências associadas.",
      startDate: dateOffset(-33, now),
      durationDays: 90,
      status: "active",
    })
    .returning();

  await db.insert(cycleTopics).values([
    { cycleId: cycle.id, topicId: network.id },
    { cycleId: cycle.id, topicId: protection.id },
    { cycleId: cycle.id, topicId: machines.id },
  ]);

  await db.insert(topicSchedules).values([
    { cycleId: cycle.id, topicId: network.id, weekday: 1, position: 0 },
    { cycleId: cycle.id, topicId: protection.id, weekday: 2, position: 0 },
    { cycleId: cycle.id, topicId: network.id, weekday: 3, position: 0 },
    { cycleId: cycle.id, topicId: machines.id, weekday: 4, position: 0 },
    { cycleId: cycle.id, topicId: network.id, weekday: 5, position: 0 },
  ]);

  const [objectiveA, objectiveB, objectiveC, objectiveD] = await db
    .insert(objectives)
    .values([
      { userId: user.id, cycleId: cycle.id, topicId: network.id, title: "Conhecer as estruturas", progress: 100, status: "completed", priority: "high" },
      { userId: user.id, cycleId: cycle.id, topicId: network.id, title: "Calcular esforços nos postes", progress: 60, status: "in_progress", priority: "high" },
      { userId: user.id, cycleId: cycle.id, topicId: network.id, title: "Dimensionar redes", progress: 35, status: "in_progress", priority: "medium" },
      { userId: user.id, cycleId: cycle.id, topicId: network.id, title: "Documentar estruturas", progress: 0, status: "not_started", priority: "medium" },
    ])
    .returning();

  await db.insert(studySessions).values([
    {
      userId: user.id,
      cycleId: cycle.id,
      topicId: network.id,
      plannedDate: dateOffset(-7, now),
      studyDate: dateOffset(-7, now),
      status: "completed",
      durationMinutes: 75,
      notes: "Revisei a classificação das estruturas N1 e N2 e resolvi os dois primeiros exemplos.",
      learnings: "O esforço longitudinal depende da diferença de trações entre os vãos adjacentes.",
      difficulties: "Preciso ganhar fluidez na leitura das tabelas de esforço.",
      nextSteps: "Retomar pelo cálculo dos esforços longitudinais e resolver o exemplo 3.",
    },
    {
      userId: user.id,
      cycleId: cycle.id,
      topicId: protection.id,
      plannedDate: dateOffset(-6, now),
      studyDate: dateOffset(-6, now),
      status: "completed",
      durationMinutes: 50,
      notes: "Comparei curvas tempo-corrente e revisei a seletividade.",
      nextSteps: "Fazer o exercício de coordenação do capítulo 3.",
    },
    {
      userId: user.id,
      cycleId: cycle.id,
      topicId: network.id,
      plannedDate: dateOffset(-2, now),
      studyDate: dateOffset(-2, now),
      status: "missed",
      notes: "Dia sem disponibilidade. Manter a pendência para a próxima sessão.",
    },
    {
      userId: user.id,
      cycleId: cycle.id,
      topicId: machines.id,
      plannedDate: dateOffset(-1, now),
      studyDate: dateOffset(-1, now),
      status: "rescheduled",
      notes: "Reagendado para a próxima semana.",
    },
    {
      userId: user.id,
      cycleId: cycle.id,
      topicId: network.id,
      plannedDate: dateOffset(0, now),
      studyDate: dateOffset(0, now),
      status: "planned",
    },
    {
      userId: user.id,
      cycleId: cycle.id,
      topicId: protection.id,
      plannedDate: dateOffset(1, now),
      studyDate: dateOffset(1, now),
      status: "planned",
    },
    {
      userId: user.id,
      cycleId: cycle.id,
      topicId: network.id,
      plannedDate: dateOffset(2, now),
      studyDate: dateOffset(2, now),
      status: "planned",
    },
  ]);

  await db.insert(tasks).values([
    { userId: user.id, cycleId: cycle.id, topicId: network.id, objectiveId: objectiveB.id, title: "Terminar exemplo 3 de esforços", priority: "high", status: "in_progress" },
    { userId: user.id, cycleId: cycle.id, topicId: network.id, objectiveId: objectiveB.id, title: "Conferir tabela de vãos", priority: "medium" },
    { userId: user.id, cycleId: cycle.id, topicId: network.id, objectiveId: objectiveC.id, title: "Fazer exercício de dimensionamento", priority: "high" },
    { userId: user.id, cycleId: cycle.id, topicId: network.id, objectiveId: objectiveD.id, title: "Documentar estrutura N1", priority: "low", status: "completed", completedAt: dateAgo(1, now) },
    { userId: user.id, cycleId: cycle.id, topicId: protection.id, title: "Ler capítulo 4", priority: "medium", status: "completed", completedAt: dateAgo(3, now) },
  ]);
}

async function getAllTopics(userId: string) {
  return db
    .select()
    .from(topics)
    .where(and(eq(topics.userId, userId), eq(topics.status, "active")))
    .orderBy(asc(topics.name));
}

function getAllObjectives(userId: string) {
  return db
    .select()
    .from(objectives)
    .where(eq(objectives.userId, userId))
    // Desempate determinístico: UPDATEs de progresso/status não podem mudar
    // a ordem de objetivos com a mesma prioridade, mesmo criados juntos.
    .orderBy(desc(objectives.priority), asc(objectives.createdAt), asc(objectives.id));
}

export async function createTopic(
  userId: string,
  input: { name: string; description?: string | null; color?: string },
) {
  const [topic] = await db
    .insert(topics)
    .values({
      userId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      color: input.color && TOPIC_COLORS.includes(input.color) ? input.color : TOPIC_COLORS[0],
    })
    .returning();
  return topic;
}

/** Atualiza nome e/ou descrição de um tema do usuário. */
export async function updateTopic(
  userId: string,
  topicId: string,
  input: { name?: string; description?: string | null },
) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof input.name === "string" && input.name.trim()) updates.name = input.name.trim().slice(0, 160);
  if (input.description !== undefined) updates.description = input.description?.trim() || null;
  const [topic] = await db
    .update(topics)
    .set(updates)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
    .returning();
  return topic ?? null;
}

/** Retorna os IDs (entre os informados) que pertencem ao usuário e estão ativos. */
export async function ownedTopicIds(userId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Set<string>();
  const rows = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.userId, userId), eq(topics.status, "active"), inArray(topics.id, unique)));
  return new Set(rows.map((row) => row.id));
}

export async function ownsCycle(userId: string, cycleId: string) {
  const [row] = await db
    .select({ id: studyCycles.id })
    .from(studyCycles)
    .where(and(eq(studyCycles.id, cycleId), eq(studyCycles.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export async function deleteTopic(userId: string, topicId: string) {
  const [topic] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
    .limit(1);
  if (!topic) return;

  // 1. Remove apenas as sessões ainda "planejadas" deste tema (somem do Calendário).
  await db
    .delete(studySessions)
    .where(and(eq(studySessions.topicId, topicId), eq(studySessions.status, "planned")));

  // 2. Retira o tema da rotina semanal de todos os ciclos.
  await db.delete(topicSchedules).where(eq(topicSchedules.topicId, topicId));

  // 3. Arquiva o tema: histórico realizado, tarefas e objetivos permanecem intactos.
  await db
    .update(topics)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(topics.id, topicId));
}

async function buildCycleSummary(userId: string, cycle: typeof studyCycles.$inferSelect, now: Date, tzOffsetMinutes = 0) {
  const [sessionRows, taskRows, objectiveRows] = await Promise.all([
    db
      .select({ status: studySessions.status, durationMinutes: studySessions.durationMinutes, isExtra: studySessions.isExtra })
      .from(studySessions)
      .where(eq(studySessions.cycleId, cycle.id)),
    db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.cycleId, cycle.id)),
    db
      .select({ status: objectives.status })
      .from(objectives)
      .where(eq(objectives.cycleId, cycle.id)),
  ]);

  const elapsed = elapsedFor(cycle, now);
  const completedSessions = sessionRows.filter((session) => session.status === "completed");

  return {
    ...cycle,
    endDate: addDays(cycle.startDate, cycle.durationDays - 1),
    elapsedDays: elapsed,
    progress: Math.round((elapsed / cycle.durationDays) * 100),
    sessionsCompleted: completedSessions.length,
    sessionsPlanned: sessionRows.filter((session) => session.status === "planned").length,
    sessionsMissed: sessionRows.filter((session) => session.status === "missed").length,
    totalMinutes: completedSessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0),
    tasksPending: taskRows.filter((task) => task.status !== "completed" && task.status !== "cancelled").length,
    tasksCompleted: taskRows.filter((task) => task.status === "completed").length,
    objectivesCompleted: objectiveRows.filter((objective) => objective.status === "completed").length,
    objectivesTotal: objectiveRows.length,
  };
}

export async function getStudyDashboard(userId: string) {
  const [user] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
  if (!user) throw new Error("Usuário não encontrado");
  const now = userNow(user);
  const tz = user.clockTzOffset ?? 0;
  const today = isoDate(now, tz);
  const allCycles = await db
    .select()
    .from(studyCycles)
    .where(eq(studyCycles.userId, user.id))
    .orderBy(desc(studyCycles.createdAt));
  const allTopics = await getAllTopics(user.id);
  const cycle = allCycles.find((item) => item.status === "active") ?? allCycles[0] ?? null;

  if (!cycle) {
    const [orphanTasks, orphanObjectives] = await Promise.all([
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          priority: tasks.priority,
          status: tasks.status,
          topicId: tasks.topicId,
          topicName: topics.name,
          topicColor: topics.color,
          sessionId: tasks.sessionId,
          cycleId: tasks.cycleId,
          createdAt: tasks.createdAt,
          completedAt: tasks.completedAt,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .leftJoin(topics, eq(tasks.topicId, topics.id))
        .where(eq(tasks.userId, user.id))
        .orderBy(desc(tasks.createdAt)),
      // Objetivos independem de ciclo: precisam aparecer na tela Temas
      // mesmo antes do primeiro ciclo ser criado.
      getAllObjectives(user.id),
    ]);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        clockMode: currentClockMode(user),
        clockNow: now.toISOString(),
      },
      today,
      cycle: null,
      cycles: [] as Awaited<ReturnType<typeof buildCycleSummary>>[],
      topics: allTopics,
      schedule: [],
      objectives: orphanObjectives,
      sessions: [],
      tasks: orphanTasks,
      currentSession: null,
      currentObjectives: [],
      latestCompleted: null,
      metrics: {
        planned: 0,
        completed: 0,
        missed: 0,
        extra: 0,
        totalMinutes: 0,
        tasksCompleted: orphanTasks.filter((task) => task.status === "completed").length,
        tasksPending: orphanTasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").length,
        objectivesCompleted: orphanObjectives.filter((objective) => objective.status === "completed").length,
      },
    };
  }

  const livingCycleIds = allCycles.filter((item) => item.status !== "cancelled").map((item) => item.id);

  const [scheduleRows, objectiveRows, sessionRows, taskRows] = await Promise.all([
    livingCycleIds.length
      ? db
          .select({
            id: topicSchedules.id,
            weekday: topicSchedules.weekday,
            position: topicSchedules.position,
            topicId: topics.id,
            topicName: topics.name,
            color: topics.color,
            cycleId: topicSchedules.cycleId,
            cycleName: studyCycles.name,
          })
          .from(topicSchedules)
          .innerJoin(topics, eq(topicSchedules.topicId, topics.id))
          .innerJoin(studyCycles, eq(topicSchedules.cycleId, studyCycles.id))
          .where(inArray(topicSchedules.cycleId, livingCycleIds))
          .orderBy(asc(topicSchedules.weekday), asc(topicSchedules.position))
      : Promise.resolve([]),
    getAllObjectives(user.id),
    db
      .select({
        id: studySessions.id,
        plannedDate: studySessions.plannedDate,
        studyDate: studySessions.studyDate,
        startTime: studySessions.startTime,
        endTime: studySessions.endTime,
        durationMinutes: studySessions.durationMinutes,
        status: studySessions.status,
        isExtra: studySessions.isExtra,
        wasReplanned: studySessions.wasReplanned,
        notes: studySessions.notes,
        learnings: studySessions.learnings,
        difficulties: studySessions.difficulties,
        questions: studySessions.questions,
        nextSteps: studySessions.nextSteps,
        topicId: topics.id,
        topicName: topics.name,
        color: topics.color,
        cycleId: studySessions.cycleId,
        cycleName: studyCycles.name,
      })
      .from(studySessions)
      .innerJoin(topics, eq(studySessions.topicId, topics.id))
      .leftJoin(studyCycles, eq(studySessions.cycleId, studyCycles.id))
      .where(eq(studySessions.userId, user.id))
      .orderBy(desc(studySessions.studyDate), desc(studySessions.createdAt)),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        status: tasks.status,
        topicId: tasks.topicId,
        topicName: topics.name,
        topicColor: topics.color,
        sessionId: tasks.sessionId,
        cycleId: tasks.cycleId,
        createdAt: tasks.createdAt,
        completedAt: tasks.completedAt,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .leftJoin(topics, eq(tasks.topicId, topics.id))
      .where(eq(tasks.userId, user.id))
      .orderBy(desc(tasks.createdAt)),
  ]);

  const cycles = await Promise.all(allCycles.map((item) => buildCycleSummary(user.id, item, now, tz)));
  const todaySessions = sessionRows.filter((session) => session.studyDate === today);
  const todaySession =
    todaySessions.find((session) => session.status === "in_progress") ??
    todaySessions.find((session) => session.status === "planned") ??
    null;
  const topicObjectives = todaySession ? objectiveRows.filter((objective) => objective.topicId === todaySession.topicId) : [];
  const latestCompleted = todaySession
    ? (sessionRows.find((session) => session.topicId === todaySession.topicId && session.status === "completed" && session.id !== todaySession.id) ?? null)
    : (sessionRows.find((session) => session.status === "completed") ?? null);
  const elapsed = elapsedFor(cycle, now);

  const completedSessions = sessionRows.filter((session) => session.status === "completed");
  const completedTasks = taskRows.filter((task) => task.status === "completed");
  const totalMinutes = completedSessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      clockMode: currentClockMode(user),
      clockNow: now.toISOString(),
    },
    today,
    cycle: { ...cycle, elapsedDays: elapsed, endDate: addDays(cycle.startDate, cycle.durationDays - 1) },
    cycles,
    topics: allTopics,
    schedule: scheduleRows,
    objectives: objectiveRows,
    sessions: sessionRows,
    tasks: taskRows,
    currentSession: todaySession,
    currentObjectives: topicObjectives,
    latestCompleted,
    metrics: {
      planned: sessionRows.filter((session) => session.status === "planned").length,
      completed: completedSessions.length,
      missed: sessionRows.filter((session) => session.status === "missed").length,
      extra: sessionRows.filter((session) => session.isExtra).length,
      totalMinutes,
      tasksCompleted: completedTasks.length,
      tasksPending: taskRows.filter((task) => task.status !== "completed" && task.status !== "cancelled").length,
      objectivesCompleted: objectiveRows.filter((objective) => objective.status === "completed").length,
    },
  };
}

export type CreateCycleInput = {
  name: string;
  description?: string;
  startDate: string;
  durationDays: number;
  topics: { id?: string; name?: string }[];
  schedule: { topicIndex: number; weekdays: number[] }[];
};

export async function createStudyCycle(userId: string, input: CreateCycleInput, now: Date, tzOffsetMinutes: number = now.getTimezoneOffset()) {
  // Só aceita temas existentes que pertençam ao próprio usuário.
  const allowed = await ownedTopicIds(
    userId,
    input.topics.map((topic) => topic.id).filter((id): id is string => Boolean(id)),
  );

  return db.transaction(async (tx) => {
    // Mantém o alinhamento posicional com `schedule[].topicIndex`: entradas
    // recusadas (tema de outro usuário ou nome vazio) viram `null`.
    const topicIds: (string | null)[] = [];
    let createdCount = 0;
    for (const topic of input.topics) {
      if (topic.id) {
        topicIds.push(allowed.has(topic.id) ? topic.id : null);
      } else if (topic.name?.trim()) {
        const [created] = await tx
          .insert(topics)
          .values({ userId, name: topic.name.trim(), color: TOPIC_COLORS[createdCount % TOPIC_COLORS.length] })
          .returning({ id: topics.id });
        createdCount += 1;
        topicIds.push(created.id);
      } else {
        topicIds.push(null);
      }
    }
    const validTopicIds = [...new Set(topicIds.filter((id): id is string => Boolean(id)))];

    const today = isoDate(now, tzOffsetMinutes);
    const [cycle] = await tx
      .insert(studyCycles)
      .values({
        userId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        startDate: input.startDate,
        durationDays: Math.max(7, Math.min(365, Math.round(Number(input.durationDays) || 90))),
        status: input.startDate <= today ? "active" : "planned",
      })
      .returning();

    if (validTopicIds.length) {
      await tx.insert(cycleTopics).values(validTopicIds.map((topicId) => ({ cycleId: cycle.id, topicId })));
    }

    const scheduleRows: { cycleId: string; topicId: string; weekday: number; position: number }[] = [];
    for (const entry of input.schedule) {
      const topicId = topicIds[entry.topicIndex];
      if (!topicId) continue;
      entry.weekdays.forEach((weekday, position) => scheduleRows.push({ cycleId: cycle.id, topicId, weekday, position }));
    }
    if (scheduleRows.length) {
      await tx.insert(topicSchedules).values(scheduleRows);
    }

    // Janela de geração em dias de calendário no fuso do usuário: começa no
    // máximo entre a data do ciclo e (hoje simulado - 7), termina em (hoje + 14).
    const clamp = dateOffset(-7, now, tzOffsetMinutes);
    const start = input.startDate > clamp ? input.startDate : clamp;
    const end = dateOffset(14, now, tzOffsetMinutes);

    const sessionRows: typeof studySessions.$inferInsert[] = [];
    for (let day = new Date(`${start}T12:00:00Z`); isoDate(day, 0) <= end; day = new Date(day.getTime() + 86400000)) {
      const weekday = day.getUTCDay();
      for (const entry of input.schedule) {
        const topicId = topicIds[entry.topicIndex];
        if (!topicId || !entry.weekdays.includes(weekday)) continue;
        const date = isoDate(day, 0);
        sessionRows.push({ userId, cycleId: cycle.id, topicId, plannedDate: date, studyDate: date, status: "planned" });
      }
    }
    if (sessionRows.length) {
      await tx.insert(studySessions).values(sessionRows);
    }

    return cycle;
  });
}

export async function deleteStudyCycle(userId: string, cycleId: string) {
  if (!(await ownsCycle(userId, cycleId))) return;
  // Remove sessões ainda planejadas deste ciclo para que não fiquem órfãs no calendário
  await db.delete(studySessions).where(
    and(eq(studySessions.cycleId, cycleId), eq(studySessions.status, "planned")),
  );
  await db.delete(studyCycles).where(and(eq(studyCycles.id, cycleId), eq(studyCycles.userId, userId)));
}

export async function updateCycleSchedule(
  userId: string,
  cycleId: string,
  entries: { topicId: string; weekdays: number[] }[],
  now: Date,
  tzOffsetMinutes: number = now.getTimezoneOffset(),
) {
  const [cycle] = await db
    .select()
    .from(studyCycles)
    .where(and(eq(studyCycles.id, cycleId), eq(studyCycles.userId, userId)))
    .limit(1);
  if (!cycle) return;

  const allowed = await ownedTopicIds(userId, entries.map((entry) => entry.topicId));
  const cleaned = entries
    .filter((entry) => allowed.has(entry.topicId))
    .map((entry) => ({
      topicId: entry.topicId,
      weekdays: [...new Set(entry.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b),
    }))
    .filter((entry) => entry.weekdays.length > 0);

  await db.transaction(async (tx) => {
    // 1. Substitui a programação semanal do ciclo
    await tx.delete(topicSchedules).where(eq(topicSchedules.cycleId, cycleId));
    const scheduleRows = cleaned.flatMap((entry) =>
      entry.weekdays.map((weekday, position) => ({ cycleId, topicId: entry.topicId, weekday, position })),
    );
    if (scheduleRows.length) {
      await tx.insert(topicSchedules).values(scheduleRows);
    }

    // 2. Garante que temas usados na rotina sejam participantes do ciclo (sem remover associações antigas)
    const usedTopicIds = [...new Set(cleaned.map((entry) => entry.topicId))];
    const existingAssoc = await tx.select({ topicId: cycleTopics.topicId }).from(cycleTopics).where(eq(cycleTopics.cycleId, cycleId));
    const existingSet = new Set(existingAssoc.map((row) => row.topicId));
    const toAdd = usedTopicIds.filter((id) => !existingSet.has(id));
    if (toAdd.length) {
      await tx.insert(cycleTopics).values(toAdd.map((topicId) => ({ cycleId, topicId })));
    }

    // 3. Sincroniza apenas o planejamento futuro (hoje → horizonte de 14 dias, limitado ao fim do ciclo).
    //    Sessões realizadas/registradas e datas passadas nunca são alteradas.
    const today = isoDate(now, tzOffsetMinutes);
    const cycleEnd = addDays(cycle.startDate, cycle.durationDays - 1);
    const windowEnd = addDays(today, 14) < cycleEnd ? addDays(today, 14) : cycleEnd;
    const windowStart = cycle.startDate > today ? cycle.startDate : today;

    const keyOf = (studyDate: string | null, topicId: string | null) => `${studyDate}|${topicId}`;

    const desired = new Map<string, { studyDate: string; topicId: string }>();
    if (windowStart <= windowEnd) {
      const byWeekday = new Map<number, string[]>();
      for (const entry of cleaned) {
        for (const weekday of entry.weekdays) {
          const list = byWeekday.get(weekday) ?? [];
          list.push(entry.topicId);
          byWeekday.set(weekday, list);
        }
      }
      for (let day = new Date(`${windowStart}T12:00:00Z`); isoDate(day, 0) <= windowEnd; day = new Date(day.getTime() + 86400000)) {
        const topicIds = byWeekday.get(day.getUTCDay()) ?? [];
        const date = isoDate(day, 0);
        for (const topicId of topicIds) {
          desired.set(keyOf(date, topicId), { studyDate: date, topicId });
        }
      }
    }

    const existingPlanned = await tx
      .select({ id: studySessions.id, studyDate: studySessions.studyDate, topicId: studySessions.topicId })
      .from(studySessions)
      .where(
        and(
          eq(studySessions.cycleId, cycleId),
          eq(studySessions.status, "planned"),
          gte(studySessions.studyDate, today),
          lte(studySessions.studyDate, windowEnd),
        ),
      );

    const toDeleteIds = existingPlanned
      .filter((row) => !desired.has(keyOf(row.studyDate, row.topicId)))
      .map((row) => row.id);
    if (toDeleteIds.length) {
      await tx.delete(studySessions).where(inArray(studySessions.id, toDeleteIds));
    }

    const keptKeys = new Set(existingPlanned.map((row) => keyOf(row.studyDate, row.topicId)));
    const toCreate = [...desired.values()].filter((d) => !keptKeys.has(keyOf(d.studyDate, d.topicId)));
    if (toCreate.length) {
      await tx.insert(studySessions).values(
        toCreate.map((d) => ({
          userId: cycle.userId,
          cycleId,
          topicId: d.topicId,
          plannedDate: d.studyDate,
          studyDate: d.studyDate,
          status: "planned" as const,
        })),
      );
    }
  });
}

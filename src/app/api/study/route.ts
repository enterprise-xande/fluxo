import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appUsers, objectives, studySessions, tasks } from "@/db/schema";
import { getRequestSessionUser, getSessionUser } from "@/lib/auth";
import { ClockUpdateError, updateUserClock, resolveNow, type ClockFields } from "@/lib/clock";
import {
  createStudyCycle,
  createTopic,
  deleteStudyCycle,
  deleteTopic,
  getStudyDashboard,
  ownedTopicIds,
  ownsCycle,
  updateCycleSchedule,
  type CreateCycleInput,
} from "@/lib/study-data";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { message: "Faça login para continuar." };

function getCurrentTime(user: ClockFields, now: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

function getTodayIso(now: Date) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function journalValues(values: Record<string, string | number | null>) {
  return {
    notes: typeof values.notes === "string" ? values.notes : null,
    learnings: typeof values.learnings === "string" ? values.learnings : null,
    difficulties: typeof values.difficulties === "string" ? values.difficulties : null,
    questions: typeof values.questions === "string" ? values.questions : null,
    nextSteps: typeof values.nextSteps === "string" ? values.nextSteps : null,
  };
}

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return Response.json(UNAUTHORIZED, { status: 401 });
    return Response.json(await getStudyDashboard(user.id));
  } catch (error) {
    console.error("Failed to load study dashboard", error);
    return Response.json({ message: "Não foi possível carregar seus estudos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      sessionToken?: unknown;
      sessionId?: string;
      taskId?: string;
      cycleId?: string;
      title?: string;
      topicId?: string | null;
      topicName?: string;
      topicDescription?: string;
      topicColor?: string;
      priority?: "low" | "medium" | "high";
      studyDate?: string;
      startTime?: string;
      endTime?: string;
      values?: Record<string, string | number | null>;
      name?: string;
      description?: string;
      startDate?: string;
      durationDays?: number;
      topics?: { id?: string; name?: string }[];
      schedule?: { topicIndex: number; weekdays: number[] }[];
      entries?: { topicId: string; weekdays: number[] }[];
    };

    // Resolve o usuário autenticado por token explícito (no JSON), cabeçalho
    // Authorization ou cookie — para TODAS as ações, inclusive em iframes onde
    // o cookie/cabeçalho pode ser removido pelo navegador ou proxy.
    const sessionUser = await getRequestSessionUser(request, body.sessionToken);
    if (!sessionUser) return Response.json(UNAUTHORIZED, { status: 401 });
    const userId = sessionUser.id;

    if (body.action === "update-system-time") {
      await updateUserClock(userId, body.studyDate, body.startTime);
      return Response.json(await getStudyDashboard(userId), { headers: { "Cache-Control": "private, no-store" } });
    }

    const [user] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
    if (!user) return Response.json({ message: "Usuário não encontrado." }, { status: 404 });
    const now = resolveNow(user);

    /* ---------- Sessões de estudo ---------- */

    if (body.action === "start-session" && body.sessionId) {
      await db
        .update(studySessions)
        .set({ status: "in_progress", startTime: getCurrentTime(user, now), updatedAt: new Date() })
        .where(and(eq(studySessions.id, body.sessionId), eq(studySessions.userId, userId)));
    }

    if (body.action === "save-session" && body.sessionId) {
      const values = body.values ?? {};
      const updates: Record<string, unknown> = { ...journalValues(values), updatedAt: new Date() };
      if (typeof values.startTime === "string") updates.startTime = values.startTime || null;
      if (typeof values.endTime === "string") updates.endTime = values.endTime || null;
      if (typeof values.durationMinutes === "number" && !isNaN(values.durationMinutes)) {
        updates.durationMinutes = values.durationMinutes;
      }
      await db
        .update(studySessions)
        .set(updates)
        .where(and(eq(studySessions.id, body.sessionId), eq(studySessions.userId, userId)));
    }

    if (body.action === "finish-session" && body.sessionId) {
      const values = body.values ?? {};
      const duration = typeof values.durationMinutes === "number" ? values.durationMinutes : 60;
      await db
        .update(studySessions)
        .set({
          status: "completed",
          endTime: getCurrentTime(user, now),
          durationMinutes: duration,
          ...journalValues(values),
          updatedAt: new Date(),
        })
        .where(and(eq(studySessions.id, body.sessionId), eq(studySessions.userId, userId)));
    }

    if (body.action === "create-extra-session" && body.topicId && body.cycleId) {
      const topicOk = (await ownedTopicIds(userId, [body.topicId])).has(body.topicId);
      const cycleOk = await ownsCycle(userId, body.cycleId);
      if (!topicOk || !cycleOk) {
        return Response.json({ message: "Tema ou ciclo inválido para esta conta." }, { status: 403 });
      }

      const studyDate = typeof body.studyDate === "string" && body.studyDate ? body.studyDate : getTodayIso(now);
      const startTime = typeof body.startTime === "string" && body.startTime ? body.startTime : getCurrentTime(user, now);
      const endTime = typeof body.endTime === "string" && body.endTime ? body.endTime : null;

      let durationMinutes: number | null = null;
      if (endTime && startTime) {
        const [startHour, startMinute] = startTime.split(":").map(Number);
        const [endHour, endMinute] = endTime.split(":").map(Number);
        const diff = endHour * 60 + endMinute - (startHour * 60 + startMinute);
        if (diff > 0) durationMinutes = diff;
      }

      await db.insert(studySessions).values({
        userId,
        cycleId: body.cycleId,
        topicId: body.topicId,
        studyDate,
        status: "in_progress",
        isExtra: true,
        startTime,
        endTime,
        durationMinutes,
      });
    }

    /* ---------- Tarefas ---------- */

    if (body.action === "toggle-task" && body.taskId) {
      const [task] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, body.taskId), eq(tasks.userId, userId)))
        .limit(1);
      if (task) {
        const completed = task.status !== "completed";
        await db
          .update(tasks)
          .set({
            status: completed ? "completed" : "pending",
            completedAt: completed ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, task.id));
      }
    }

    if (body.action === "create-task" && body.title?.trim() && body.topicId) {
      const topicOk = (await ownedTopicIds(userId, [body.topicId])).has(body.topicId);
      if (!topicOk) return Response.json({ message: "Tema inválido para esta conta." }, { status: 403 });
      const cycleId = body.cycleId && (await ownsCycle(userId, body.cycleId)) ? body.cycleId : null;
      await db.insert(tasks).values({
        userId,
        cycleId,
        topicId: body.topicId,
        title: body.title.trim(),
        priority: body.priority && ["low", "medium", "high"].includes(body.priority) ? body.priority : "medium",
        status: "pending",
        sessionId: body.sessionId ?? null,
      });
    }

    if (body.action === "delete-task" && body.taskId) {
      await db.delete(tasks).where(and(eq(tasks.id, body.taskId), eq(tasks.userId, userId)));
    }

    /* ---------- Ciclos ---------- */

    if (body.action === "create-cycle") {
      const input: CreateCycleInput = {
        name: body.name ?? "",
        description: body.description ?? "",
        startDate: body.startDate ?? getTodayIso(now),
        durationDays: Number(body.durationDays) || 90,
        topics: Array.isArray(body.topics) ? body.topics : [],
        schedule: Array.isArray(body.schedule) ? body.schedule : [],
      };
      if (!input.name.trim()) return Response.json({ message: "Informe o nome do ciclo." }, { status: 400 });
      await createStudyCycle(userId, input, now);
    }

    if (body.action === "delete-cycle" && body.cycleId) {
      await deleteStudyCycle(userId, body.cycleId);
    }

    if (body.action === "update-schedule" && body.cycleId && Array.isArray(body.entries)) {
      await updateCycleSchedule(userId, body.cycleId, body.entries, now);
    }

    /* ---------- Temas ---------- */

    if (body.action === "create-topic" && body.topicName?.trim()) {
      await createTopic(userId, {
        name: body.topicName,
        description: body.topicDescription ?? null,
        color: body.topicColor,
      });
    }

    if (body.action === "delete-topic" && body.topicId) {
      await deleteTopic(userId, body.topicId);
    }

    /* ---------- Objetivos ---------- */

    if (body.action === "create-objective" && body.title?.trim() && body.topicId) {
      const topicOk = (await ownedTopicIds(userId, [body.topicId])).has(body.topicId);
      if (!topicOk) return Response.json({ message: "Tema inválido para esta conta." }, { status: 403 });
      const cycleId = body.cycleId && (await ownsCycle(userId, body.cycleId)) ? body.cycleId : null;
      await db.insert(objectives).values({
        userId,
        cycleId,
        topicId: body.topicId,
        title: body.title.trim(),
        priority: body.priority && ["low", "medium", "high"].includes(body.priority) ? body.priority : "medium",
      });
    }

    if (body.action === "update-objective" && body.values && typeof (body.values as Record<string, unknown>).objectiveId === "string") {
      const vals = body.values as Record<string, unknown>;
      const id = vals.objectiveId as string;
      const updates: Record<string, unknown> = {};
      if (typeof vals.title === "string") updates.title = vals.title.trim();
      if (typeof vals.progress === "number") updates.progress = Math.max(0, Math.min(100, vals.progress));
      if (typeof vals.status === "string" && ["not_started", "in_progress", "completed"].includes(vals.status as string)) {
        updates.status = vals.status;
      }
      if (Object.keys(updates).length > 0) {
        await db
          .update(objectives)
          .set(updates)
          .where(and(eq(objectives.id, id), eq(objectives.userId, userId)));
      }
    }

    if (body.action === "delete-objective" && body.values && typeof (body.values as Record<string, unknown>).objectiveId === "string") {
      const id = (body.values as Record<string, unknown>).objectiveId as string;
      await db.delete(objectives).where(and(eq(objectives.id, id), eq(objectives.userId, userId)));
    }

    return Response.json(await getStudyDashboard(userId));
  } catch (error) {
    if (error instanceof ClockUpdateError) {
      return Response.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to update study dashboard", error);
    return Response.json({ message: "Não foi possível salvar a alteração." }, { status: 500 });
  }
}

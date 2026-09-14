"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthScreen from "@/components/auth-screen";
import { apiFetch, clearSessionToken, getSessionToken, setSessionToken } from "@/lib/session-token";

type SessionStatus = "planned" | "in_progress" | "completed" | "missed" | "rescheduled";
type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

type StudySession = {
  id: string;
  plannedDate: string | null;
  studyDate: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  status: SessionStatus;
  isExtra: boolean;
  wasReplanned: boolean;
  notes: string | null;
  learnings: string | null;
  difficulties: string | null;
  questions: string | null;
  nextSteps: string | null;
  topicId: string;
  topicName: string;
  color: string;
  cycleId: string | null;
  cycleName: string | null;
};

type Task = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  status: TaskStatus;
  topicId: string | null;
  topicName: string | null;
  topicColor: string | null;
  sessionId: string | null;
  cycleId: string | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
};

type Objective = {
  id: string;
  title: string;
  progress: number;
  status: "not_started" | "in_progress" | "completed";
  priority: "low" | "medium" | "high";
  topicId: string | null;
  cycleId: string | null;
};

type TopicItem = { id: string; name: string; description: string | null; color: string };

type Cycle = {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  durationDays: number;
  endDate: string;
  status: string;
  elapsedDays: number;
};

type CycleSummary = Cycle & {
  progress: number;
  sessionsCompleted: number;
  sessionsPlanned: number;
  sessionsMissed: number;
  totalMinutes: number;
  tasksPending: number;
  tasksCompleted: number;
  objectivesCompleted: number;
  objectivesTotal: number;
};

type CreateCyclePayload = {
  name: string;
  description: string;
  startDate: string;
  durationDays: number;
  topics: { id?: string; name?: string }[];
  schedule: { topicIndex: number; weekdays: number[] }[];
};

type Dashboard = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    clockMode: "auto" | "simulated";
    clockNow: string;
  };
  today: string;
  cycle: Cycle | null;
  cycles: CycleSummary[];
  topics: TopicItem[];
  schedule: { id: string; weekday: number; position: number; topicId: string; topicName: string; color: string; cycleId: string; cycleName: string }[];
  objectives: Objective[];
  sessions: StudySession[];
  tasks: Task[];
  currentSession: StudySession | null;
  currentObjectives: Objective[];
  latestCompleted: StudySession | null;
  metrics: {
    planned: number;
    completed: number;
    missed: number;
    extra: number;
    totalMinutes: number;
    tasksCompleted: number;
    tasksPending: number;
    objectivesCompleted: number;
  };
};

type View = "today" | "calendar" | "cycles" | "topics" | "tasks" | "history" | "dashboard";
type Journal = { notes: string; learnings: string; difficulties: string; questions: string; nextSteps: string };

const navItems: { id: View; label: string; icon: string }[] = [
  { id: "today", label: "Hoje", icon: "spark" },
  { id: "calendar", label: "Calendário", icon: "calendar" },
  { id: "cycles", label: "Ciclos", icon: "layers" },
  { id: "topics", label: "Temas", icon: "book" },
  { id: "tasks", label: "Tarefas", icon: "check" },
  { id: "history", label: "Histórico", icon: "clock" },
  { id: "dashboard", label: "Dashboard", icon: "chart" },
];

const weekdayShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const weekdayLong = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const TASK_ENTER_MS = 820;
const TASK_EXIT_MS = 680;
const TODAY_EXIT_MS = 720;
const TODAY_BLOCKS_KEY = "fluxo.today.blocksVisible";

function waitForTaskAnimation(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const cycleStatusLabel: Record<string, string> = {
  planned: "Planejado",
  active: "Em andamento",
  paused: "Pausado",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const cycleStatusClass: Record<string, string> = {
  planned: "c-planned",
  active: "c-active",
  paused: "c-paused",
  completed: "c-completed",
  cancelled: "c-cancelled",
};

function Icon({ name, size = 18, stroke = 1.8 }: { name: string; size?: number; stroke?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<string, React.ReactNode> = {
    spark: <><path d="m12 3-1.4 5.6L5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4L12 3Z" /><path d="m19 16-.5 2-.5-2-2-.5 2-.5.5-2 .5 2 2 .5-2 .5Z" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 19a2 2 0 0 1 2-2h14M8 7h8" /></>,
    check: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m8 12 2.5 2.5L16.5 9" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    play: <path d="m9 6 9 6-9 6V6Z" fill="currentColor" stroke="none" />,
    save: <><path d="M5 3h12l3 3v15H5V3Z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    "more-v": <><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7l0-7Z" />,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="m17.7 6.3 3-3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
    lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.spark}</svg>;
}

function localIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0]?.slice(0, 2) ?? "");
  return letters.toUpperCase() || "?";
}

/** Dias consecutivos (terminando hoje ou ontem) com ao menos uma sessão concluída. */
function computeStreak(sessions: { studyDate: string; status: SessionStatus }[], today: string) {
  const studiedDays = new Set(sessions.filter((session) => session.status === "completed").map((session) => session.studyDate));
  const cursor = new Date(`${today}T12:00:00`);
  if (!studiedDays.has(localIsoDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (studiedDays.has(localIsoDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function formatDate(value: string | null, compact = false) {
  if (!value) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: compact ? "short" : "long", year: compact ? undefined : "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatClock(iso: string) {
  if (!iso) return "—";
  const date = new Date(iso);
  return `${weekdayLong[date.getDay()]}, ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(date)} às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date)}`;
}

function timeLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h${remaining ? String(remaining).padStart(2, "0") : ""}` : `${remaining}min`;
}

function sessionLabel(status: SessionStatus) {
  return { planned: "Planejada", in_progress: "Em andamento", completed: "Concluída", missed: "Não realizada", rescheduled: "Reagendada" }[status];
}

function statusClass(status: SessionStatus) {
  return { planned: "status-planned", in_progress: "status-progress", completed: "status-completed", missed: "status-missed", rescheduled: "status-rescheduled" }[status];
}

function LoadingState() {
  return <main className="loading-shell"><div className="loading-mark">F</div><p>Organizando seu próximo foco…</p></main>;
}

export default function HomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [view, setView] = useState<View>("today");
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [journal, setJournal] = useState<Journal>({ notes: "", learnings: "", difficulties: "", questions: "", nextSteps: "" });
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [taskTitle, setTaskTitle] = useState("");
  const [enteringTaskIds, setEnteringTaskIds] = useState<Set<string>>(new Set());
  const [leavingTaskIds, setLeavingTaskIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const [blocksVisible, setBlocksVisible] = useState(true);
  const [todayMode, setTodayMode] = useState<"visible" | "exiting">("visible");
  const [extraOpen, setExtraOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [inspectingSession, setInspectingSession] = useState<StudySession | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [authState, setAuthState] = useState<"loading" | "guest" | "authenticated">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clockSaving, setClockSaving] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);
  const clockSaveRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);

  const authenticatedFetch = useCallback((input: RequestInfo | URL, init: RequestInit = {}) => {
    return apiFetch(input, init, authTokenRef.current);
  }, []);

  const loadData = useCallback(async (tokenOverride?: string) => {
    const requestId = ++loadRequestRef.current;
    setLoadError(null);
    try {
      const response = await apiFetch("/api/study", { cache: "no-store" }, tokenOverride ?? authTokenRef.current);

      // Uma resposta de uma requisição anterior não pode desfazer um login novo.
      if (requestId !== loadRequestRef.current) return;

      if (response.status === 401) {
        authTokenRef.current = null;
        clearSessionToken();
        setData(null);
        setAuthState("guest");
        return;
      }
      if (!response.ok) throw new Error(`Falha ao carregar (${response.status})`);
      const payload = (await response.json()) as Dashboard;
      setData(payload);
      setAuthState("authenticated");
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      console.error("Failed to load dashboard", error);
      setLoadError("Não foi possível carregar seus estudos. Verifique a conexão e tente novamente.");
      // Se for erro de rede pós-login, não o joga pra 'guest' silenciosamente. Mantém em 'loading' com erro.
      setAuthState("loading");
    }
  }, [authenticatedFetch]);

  // Chamada inicial de carregamento ao montar. Se o formulário foi enviado
  // nativamente, recebe o token pelo fragmento, limpa a URL e autentica primeiro.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const tokenFromRedirect = hash.get("session");
    if (tokenFromRedirect) {
      setSessionToken(tokenFromRedirect);
      authTokenRef.current = tokenFromRedirect;
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
      void loadData(tokenFromRedirect);
    } else {
      void loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentUserId = data?.user.id ?? null;

  useEffect(() => {
    if (!currentUserId) return;
    try {
      const stored = window.localStorage.getItem(`${TODAY_BLOCKS_KEY}.${currentUserId}`);
      setBlocksVisible(stored !== "false");
    } catch {
      /* localStorage indisponível: mantém o padrão visível */
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    try {
      window.localStorage.setItem(`${TODAY_BLOCKS_KEY}.${currentUserId}`, String(blocksVisible));
    } catch {
      /* ignora falhas de persistência */
    }
  }, [blocksVisible, currentUserId]);

  useEffect(() => {
    const session = focusedSessionId
      ? (data?.sessions.find((item) => item.id === focusedSessionId) ?? null)
      : (data?.currentSession ?? null);
    if (!session) return;
    setJournal({
      notes: session.notes ?? "",
      learnings: session.learnings ?? "",
      difficulties: session.difficulties ?? "",
      questions: session.questions ?? "",
      nextSteps: session.nextSteps ?? "",
    });
    setSaveState("saved");
  }, [data, focusedSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const apiAction = useCallback(async (body: Record<string, unknown>, refresh = true) => {
    const sessionToken = authTokenRef.current ?? getSessionToken() ?? undefined;
    const response = await authenticatedFetch("/api/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, sessionToken }),
    });
    if (response.status === 401) {
      // Sessão expirou ou foi encerrada em outra aba: volta para a tela de acesso.
      authTokenRef.current = null;
      clearSessionToken();
      setData(null);
      setAuthState("guest");
      throw new Error("Sessão expirada");
    }
    if (!response.ok) throw new Error("Unable to save changes");
    const payload = (await response.json()) as Dashboard;
    if (refresh) setData(payload);
    return payload;
  }, [authenticatedFetch]);

  const resetWorkspace = useCallback(() => {
    loadRequestRef.current += 1;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setProfileOpen(false);
    setClockError(null);
    setData(null);
    setView("today");
    setMenuOpen(false);
    setCreateOpen(false);
    setExtraOpen(false);
    setConfirmDelete(null);
    setInspectingSession(null);
    setFocusedSessionId(null);
    setSelectedDay(null);
    setTaskTitle("");
    setJournal({ notes: "", learnings: "", difficulties: "", questions: "", nextSteps: "" });
    setSaveState("saved");
    setBlocksVisible(true);
    setTodayMode("visible");
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await authenticatedFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* mesmo sem resposta, encerramos a sessão local */
    }
    authTokenRef.current = null;
    clearSessionToken();
    resetWorkspace();
    setAuthState("guest");
  }, [authenticatedFetch, resetWorkspace]);

  const handleAuthenticated = useCallback((
    _user: { id: string; name: string; email: string },
    token: string,
    workspace: unknown,
  ) => {
    // O login já entrega o ambiente carregado: não há tela intermediária nem
    // segunda requisição capaz de devolver o usuário ao formulário.
    authTokenRef.current = token;
    loadRequestRef.current += 1; // invalida eventual carregamento inicial pendente
    resetWorkspace();
    setLoadError(null);
    setData(workspace as Dashboard);
    setAuthState("authenticated");
  }, [resetWorkspace]);

  const saveSystemTime = useCallback(async (studyDate: string, startTime: string) => {
    if (clockSaveRef.current) throw new Error("Aguarde o salvamento do horário em andamento.");
    const accountId = currentUserId;
    const requestEpoch = loadRequestRef.current;
    const sessionToken = authTokenRef.current ?? getSessionToken();
    clockSaveRef.current = true;
    setClockSaving(true);
    setClockError(null);
    try {
      const response = await authenticatedFetch("/api/admin/clock", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyDate,
          startTime,
          // Fuso do navegador (convenção getTimezoneOffset: UTC−3 → 180) para o
          // servidor interpretar a data/hora escolhida no fuso do usuário.
          tzOffset: new Date().getTimezoneOffset(),
          sessionToken: sessionToken ?? undefined,
        }),
      });
      const payload = await response.json().catch(() => null) as (Dashboard & { message?: string }) | null;
      if (requestEpoch !== loadRequestRef.current) return;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível salvar o horário. Tente novamente.");
      }
      if (!payload?.user || payload.user.id !== accountId || !Array.isArray(payload.sessions)) {
        throw new Error("O servidor não confirmou a atualização do relógio desta conta.");
      }
      setData(payload);
      setFocusedSessionId(null);
      setSelectedDay(null);
      setCalendarMonth(new Date(`${payload.today}T12:00:00`));
      // Esta operação nunca limpa o token, navega para login ou renova a sessão.
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível salvar o horário.";
      if (requestEpoch === loadRequestRef.current) setClockError(message);
      throw new Error(message);
    } finally {
      clockSaveRef.current = false;
      setClockSaving(false);
    }
  }, [authenticatedFetch, currentUserId]);

  const saveJournal = useCallback(async (values = journal) => {
    if (!data) return;
    const session = focusedSessionId
      ? (data.sessions.find((item) => item.id === focusedSessionId) ?? null)
      : (data.currentSession ?? null);
    if (!session) return;
    setSaveState("saving");
    try {
      await apiAction({ action: "save-session", sessionId: session.id, values }, false);
      setSaveState("saved");
    } catch {
      setSaveState("unsaved");
    }
  }, [apiAction, data, journal, focusedSessionId]);

  const editJournal = (key: keyof Journal, value: string) => {
    const nextJournal = { ...journal, [key]: value };
    setJournal(nextJournal);
    setSaveState("unsaved");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void saveJournal(nextJournal); }, 900);
  };

  if (authState === "guest") return <AuthScreen onAuthenticated={handleAuthenticated} />;
  if (!data && loadError) {
    return (
      <main className="loading-shell">
        <div className="loading-mark">F</div>
        <p>{loadError}</p>
        <div className="loading-actions">
          <button className="primary-button" onClick={() => void loadData()}><Icon name="arrow" size={16} /> Tentar novamente</button>
          <button className="quiet-button" onClick={() => void handleLogout()}>Sair da conta</button>
        </div>
      </main>
    );
  }
  if (!data) return <LoadingState />;

  const userInitials = initialsOf(data.user.name);
  const streakDays = computeStreak(data.sessions, data.today);

  const focusedSession = focusedSessionId
    ? (data.sessions.find((item) => item.id === focusedSessionId) ?? null)
    : null;
  const current = focusedSession ?? data.currentSession;
  const cycleProgress = data.cycle ? Math.round((data.cycle.elapsedDays / data.cycle.durationDays) * 100) : 0;
  const dateObject = new Date(`${data.today}T12:00:00`);

  const markTaskEntering = (taskId: string) => {
    setEnteringTaskIds((prev) => new Set([...prev, taskId]));
    setTimeout(() => {
      setEnteringTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }, TASK_ENTER_MS);
  };

  const createTaskInSession = async (event: FormEvent) => {
    event.preventDefault();
    const topicId = current?.topicId ?? data.topics[0]?.id ?? null;
    if (!taskTitle.trim() || !topicId) return;
    const prevIds = new Set(data.tasks.map((t) => t.id));
    const title = taskTitle.trim();
    setTaskTitle("");
    const updated = await apiAction({
      action: "create-task",
      title,
      topicId,
      cycleId: data.cycle?.id ?? null,
      sessionId: current?.id ?? null,
      priority: "medium",
    });
    const newlyAdded = updated.tasks.find((t) => !prevIds.has(t.id));
    if (newlyAdded) {
      markTaskEntering(newlyAdded.id);
    }
  };

  const handleCreateTask = async (payload: {
    title: string;
    topicId: string;
    cycleId: string | null;
    priority: Task["priority"];
  }) => {
    const prevIds = new Set(data.tasks.map((t) => t.id));
    const updated = await apiAction({ action: "create-task", ...payload });
    const newlyAdded = updated.tasks.find((t) => !prevIds.has(t.id));
    if (newlyAdded) {
      markTaskEntering(newlyAdded.id);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    setLeavingTaskIds((prev) => new Set([...prev, taskId]));
    await waitForTaskAnimation(TASK_EXIT_MS);
    await apiAction({ action: "delete-task", taskId });
    setLeavingTaskIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  };

  const requestDeleteTask = (taskId: string) => {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    setConfirmDelete(task);
  };

  const handleCreateExtraSession = async (
    topicId: string,
    options: { studyDate?: string; startTime?: string; endTime?: string },
  ) => {
    if (!data.cycle) return;
    const prevIds = new Set(data.sessions.map((s) => s.id));
    const updated = await apiAction({
      action: "create-extra-session",
      topicId,
      cycleId: data.schedule.find((item) => item.topicId === topicId)?.cycleId ?? data.cycle.id,
      ...options,
    });
    const created = updated.sessions.find((s) => !prevIds.has(s.id));
    if (created) {
      setFocusedSessionId(created.id);
      setBlocksVisible(true);
      setTodayMode("visible");
    }
    setExtraOpen(false);
  };

  const handleFinishToday = () => {
    if (!current || todayMode === "exiting") return;
    setBlocksVisible(false);
    setTodayMode("exiting");
    const sessionId = current.id;
    let duration = current.durationMinutes ?? 75;
    if (current.startTime && current.endTime) {
      const [startHour, startMinute] = current.startTime.split(":").map(Number);
      const [endHour, endMinute] = current.endTime.split(":").map(Number);
      const diff = endHour * 60 + endMinute - (startHour * 60 + startMinute);
      if (diff > 0) duration = diff;
    }
    const values = { ...journal, durationMinutes: duration };
    void (async () => {
      await waitForTaskAnimation(TODAY_EXIT_MS);
      await apiAction({ action: "finish-session", sessionId, values });
      setTodayMode("visible");
      setFocusedSessionId(null);
    })();
  };

  const handleToggleTaskOnToday = async (taskId: string) => {
    const task = data.tasks.find((t) => t.id === taskId);
    if (task && task.status !== "completed") {
      setLeavingTaskIds((prev) => new Set([...prev, taskId]));
      await waitForTaskAnimation(TASK_EXIT_MS);
    }
    await apiAction({ action: "toggle-task", taskId });
    setLeavingTaskIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  };

  const handleToggleTaskInTasks = async (taskId: string) => {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return;

    setLeavingTaskIds((prev) => new Set([...prev, taskId]));
    await waitForTaskAnimation(TASK_EXIT_MS);
    const updated = await apiAction({ action: "toggle-task", taskId }, false);
    setData(updated);
    setLeavingTaskIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
    markTaskEntering(taskId);
  };

  const renderView = () => {
    switch (view) {
      case "calendar":
        return (
          <CalendarView
            data={data}
            month={calendarMonth}
            setMonth={setCalendarMonth}
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            onInspectSession={(session) => setInspectingSession(session)}
          />
        );
      case "cycles": return <CyclesView data={data} createOpen={createOpen} setCreateOpen={setCreateOpen} onCreate={(payload) => void apiAction({ action: "create-cycle", ...payload })} onDelete={(cycleId) => void apiAction({ action: "delete-cycle", cycleId })} onSaveSchedule={(cycleId, entries) => void apiAction({ action: "update-schedule", cycleId, entries })} onToday={() => setView("today")} />;
      case "topics":
        return (
          <TopicsView
            data={data}
            onCreateObjective={(topicId, title) => void apiAction({ action: "create-objective", topicId, title, cycleId: data.cycle?.id ?? null })}
            onUpdateObjective={(objectiveId, values) => void apiAction({ action: "update-objective", values: { objectiveId, ...values } })}
            onDeleteObjective={(objectiveId) => void apiAction({ action: "delete-objective", values: { objectiveId } })}
            onCreateTopic={(payload) => void apiAction({ action: "create-topic", ...payload })}
            onDeleteTopic={(topicId) => void apiAction({ action: "delete-topic", topicId })}
            onUpdateTopic={(topicId, payload) => void apiAction({ action: "update-topic", topicId, ...payload })}
          />
        );
      case "tasks":
        return (
          <TasksView
            data={data}
            onToggle={(taskId) => void handleToggleTaskInTasks(taskId)}
            onCreate={handleCreateTask}
            onRequestDelete={requestDeleteTask}
            enteringTaskIds={enteringTaskIds}
            leavingTaskIds={leavingTaskIds}
          />
        );
      case "history": return <HistoryView data={data} onInspectSession={(session) => setInspectingSession(session)} />;
      case "dashboard": return <DashboardView data={data} />;
      default: {
        if (!data.cycle) {
          return <NoCycleView onStart={() => { setCreateOpen(true); setView("cycles"); }} />;
        }
        if (!current) {
          return <FreeDayView
            data={data}
            cycle={data.cycle}
            taskTitle={taskTitle}
            setTaskTitle={setTaskTitle}
            onCreateTask={createTaskInSession}
            onToggle={(taskId) => void handleToggleTaskOnToday(taskId)}
            onDelete={requestDeleteTask}
            onStartTopic={(topicId) => void handleCreateExtraSession(topicId, {})}
            onOpenExtra={() => setExtraOpen(true)}
            onCalendar={() => setView("calendar")}
            enteringTaskIds={enteringTaskIds}
            leavingTaskIds={leavingTaskIds}
            blocksVisible={blocksVisible}
            onToggleBlocks={() => setBlocksVisible((previous) => !previous)}
          />;
        }
        const currentTasks = data.tasks.filter(
          (task) => task.topicId === current.topicId && task.status !== "completed" && task.status !== "cancelled",
        );
        return <TodayView
          data={data}
          cycle={data.cycle}
          current={current}
          currentTasks={currentTasks}
          journal={journal}
          saveState={saveState}
          cycleProgress={cycleProgress}
          dateObject={dateObject}
          taskTitle={taskTitle}
          setTaskTitle={setTaskTitle}
          onJournalChange={editJournal}
          onSave={() => void saveJournal()}
          onStart={() => void apiAction({ action: "start-session", sessionId: current.id })}
          onFinish={handleFinishToday}
          onToggle={(taskId) => void handleToggleTaskOnToday(taskId)}
          onDelete={requestDeleteTask}
          onCreateTask={createTaskInSession}
          onHistory={() => setView("history")}
          onOpenExtra={() => setExtraOpen(true)}
          enteringTaskIds={enteringTaskIds}
          leavingTaskIds={leavingTaskIds}
          blocksVisible={blocksVisible}
          onToggleBlocks={() => setBlocksVisible((previous) => !previous)}
          isExiting={todayMode === "exiting"}
        />;
      }
    }
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row"><div className="brand-mark">F</div><span>fluxo<span className="brand-dot">.</span></span><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><Icon name="close" /></button></div>
        <button type="button" className="workspace" onClick={() => setProfileOpen(true)} title="Abrir perfil"><div className="avatar">{userInitials}</div><div><strong>{data.user.name}</strong><span title={data.user.email}>{data.user.email}</span></div></button>
        <nav className="main-nav" aria-label="Navegação principal">
          <p className="nav-caption">ORGANIZAÇÃO</p>
          {navItems.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => { setView(item.id); setMenuOpen(false); }}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.id === "tasks" && data.metrics.tasksPending > 0 ? <b>{data.metrics.tasksPending}</b> : null}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="focus-mini">
            <span><Icon name="bolt" size={15} /></span>
            <div>
              <small>Sequência atual</small>
              <strong>{streakDays === 0 ? "Comece hoje" : `${streakDays} ${streakDays === 1 ? "dia" : "dias"} de foco`}</strong>
            </div>
          </div>
          <button className="logout-button" onClick={() => void handleLogout()}><Icon name="logout" size={15} /> Sair da conta</button>
        </div>
      </aside>
      <div className="mobile-overlay" onClick={() => setMenuOpen(false)} />
      <section className="content-shell">
        <header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Icon name="menu" /></button><div className="crumb"><span>{view === "today" ? "Hoje" : navItems.find((item) => item.id === view)?.label}</span><span className="crumb-muted">/ {data.cycle?.name ?? "Sem ciclo"}</span></div><div className="top-actions"><button className="icon-button" aria-label="Notificações"><span className="notification-dot" /><Icon name="spark" size={19} /></button><button className="top-avatar" onClick={() => setProfileOpen(true)} title={`${data.user.name} · ${data.user.email}`} aria-label="Conta atual">{userInitials}</button></div></header>
        <div className="page-content">
          {data.user.clockMode === "simulated" ? (
            <div className="simulated-time-banner">
              <span className="sim-banner-label">
                <Icon name="bolt" size={14} />
                <span className="sim-banner-text">Modo simulação ativo: exibindo como</span>
              </span>
              <strong>{formatClock(data.user.clockNow)}</strong>
              <button
                type="button"
                className="banner-reset-btn"
                disabled={clockSaving}
                onClick={() => { void saveSystemTime("", "").catch(() => undefined); }}
              >
                {clockSaving ? "Restaurando…" : "Restaurar real"}
              </button>
            </div>
          ) : null}
          {clockError && !profileOpen ? <p className="profile-msg err" role="alert">{clockError}</p> : null}
          {renderView()}
        </div>
      </section>
      {confirmDelete ? (
        <ConfirmModal
          title="Excluir tarefa"
          body={`A tarefa "${confirmDelete.title}" será removida permanentemente.`}
          confirmLabel="Excluir tarefa"
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            const taskId = confirmDelete.id;
            setConfirmDelete(null);
            void handleDeleteTask(taskId);
          }}
        />
      ) : null}
      {extraOpen ? (
        <ExtraSessionModal
          topics={data.topics}
          today={data.today}
          onClose={() => setExtraOpen(false)}
          onCreate={(topicId, options) => void handleCreateExtraSession(topicId, options)}
        />
      ) : null}
      {inspectingSession ? (
        <SessionDetailModal
          session={inspectingSession}
          data={data}
          onClose={() => setInspectingSession(null)}
          onSave={async (id, values) => {
            const updated = await apiAction({ action: "save-session", sessionId: id, values });
            const fresh = updated.sessions.find((s) => s.id === id);
            if (fresh) setInspectingSession(fresh);
          }}
        />
      ) : null}
      {profileOpen ? (
        <ProfileModal
          user={data.user}
          today={data.today}
          sessionToken={authTokenRef.current ?? getSessionToken()}
          fetcher={authenticatedFetch}
          onSaveSystemTime={saveSystemTime}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
    </main>
  );
}

function NoCycleView({ onStart }: { onStart: () => void }) {
  return <section className="screen-view"><div className="empty-hero"><div className="empty-hero-icon"><Icon name="layers" size={28} /></div><p className="eyebrow">COMEÇANDO</p><h1>Você ainda não tem um ciclo</h1><p>Um ciclo dá ritmo aos estudos: temas, uma programação semanal e um período definido para evoluir.</p><button className="primary-button" onClick={onStart}><Icon name="plus" size={18} /> Criar meu primeiro ciclo</button></div></section>;
}

function FreeDayView({
  data,
  cycle,
  taskTitle,
  setTaskTitle,
  onCreateTask,
  onToggle,
  onDelete,
  onStartTopic,
  onOpenExtra,
  onCalendar,
  enteringTaskIds,
  leavingTaskIds,
  blocksVisible = true,
  onToggleBlocks,
}: {
  data: Dashboard;
  cycle: Cycle;
  taskTitle: string;
  setTaskTitle: (value: string) => void;
  onCreateTask: (event: FormEvent) => void;
  onToggle: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onStartTopic: (topicId: string) => void;
  onOpenExtra?: () => void;
  onCalendar: () => void;
  enteringTaskIds?: Set<string>;
  leavingTaskIds?: Set<string>;
  blocksVisible?: boolean;
  onToggleBlocks?: () => void;
}) {
  const cycleTopicIds = new Set(data.schedule.map((item) => item.topicId));
  const cycleTopics = data.topics.filter((topic) => cycleTopicIds.size === 0 || cycleTopicIds.has(topic.id));
  const openTasks = data.tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
  const upcoming = data.sessions.filter((session) => session.studyDate > data.today && session.status === "planned").slice(0, 4);
  return <>
    <section className="today-heading"><div><p className="eyebrow"><span className="live-dot" /> DIA LIVRE</p><h1>Nada programado para hoje</h1><p className="heading-copy">Use o tempo para adiantar pendências ou comece um tema por conta própria.</p></div><div className="heading-actions"><button className="quiet-button" onClick={onCalendar}><Icon name="calendar" size={17} /> Ver calendário</button>{onOpenExtra ? <button className="extra-fab" onClick={onOpenExtra} title="Nova sessão extra ou retroativa" aria-label="Nova sessão extra ou retroativa"><Icon name="plus" size={19} /></button> : null}</div></section>
    <section className="focus-card free-day"><div className="focus-orb orb-one" /><div className="focus-orb orb-two" />
      <div className="focus-content"><div className="focus-topline"><span className="focus-tag">HOJE</span><span className="status-chip status-planned"><i /> Dia livre</span></div><div className="focus-body"><div><h2>Escolha um tema para estudar</h2><p>{cycle.name} <span>·</span> Dia {cycle.elapsedDays} de {cycle.durationDays}</p><div className="topic-chip-row">{cycleTopics.map((topic) => <button key={topic.id} onClick={() => onStartTopic(topic.id)}><span className={`topic-icon ${topic.color}`}><Icon name="play" size={13} /></span>{topic.name}</button>)}</div></div></div></div>
      <div className="focus-footer"><div><span className="calendar-glyph"><Icon name="bolt" size={17} /></span><span>Cada tema iniciado vira uma sessão extra registrada no seu histórico</span></div></div>
    </section>
    <div className="today-blocks blocks-closed free-day-blocks-hidden">
    <section className="study-grid">
      <article className="card"><header className="card-title"><div><p className="card-kicker">PRÓXIMAS SESSÕES</p><h2>O que vem por aí</h2></div></header><div className="task-list">{upcoming.map((session) => <div key={session.id} className="upcoming-row"><div className="upcoming-day"><strong>{new Date(`${session.studyDate}T12:00:00`).getDate()}</strong>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(`${session.studyDate}T12:00:00`)).replace(".", "")}</div><div><h3>{session.topicName}</h3><p>{weekdayLong[new Date(`${session.studyDate}T12:00:00`).getDay()]}</p></div><Icon name="clock" size={15} /></div>)}</div>{upcoming.length === 0 && <div className="empty"><span><Icon name="calendar" size={18} /></span><p>Nenhuma sessão planejada nos próximos dias.</p></div>}</article>
      <article className="card tasks-card"><header className="card-title"><div><p className="card-kicker">PENDÊNCIAS</p><h2>Tarefas abertas</h2></div><span className="task-count">{openTasks.length} abertas</span></header>
        <div className="task-list">
          {openTasks.slice(0, 5).map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              dense
              onToggle={() => onToggle(task.id)}
              onDelete={onDelete ? () => onDelete(task.id) : undefined}
              isEntering={enteringTaskIds?.has(task.id)}
              isLeaving={leavingTaskIds?.has(task.id)}
            />
          ))}
        </div>
        <form className="quick-add" onSubmit={onCreateTask}><button type="submit" onClick={(e) => { if (!taskTitle.trim()) { e.preventDefault(); } }} aria-label="Adicionar tarefa"><Icon name="plus" size={16} /></button><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Adicionar uma tarefa rápida" /></form>
      </article>
    </section>
    </div>
  </>;
}

function TodayView({
  data,
  cycle,
  current,
  currentTasks,
  journal,
  saveState,
  cycleProgress,
  dateObject,
  taskTitle,
  setTaskTitle,
  onJournalChange,
  onSave,
  onStart,
  onFinish,
  onToggle,
  onDelete,
  onCreateTask,
  onHistory,
  onOpenExtra,
  enteringTaskIds,
  leavingTaskIds,
  blocksVisible = true,
  onToggleBlocks,
  isExiting = false,
}: {
  data: Dashboard;
  cycle: Cycle;
  current: StudySession;
  currentTasks: Task[];
  journal: Journal;
  saveState: "saved" | "saving" | "unsaved";
  cycleProgress: number;
  dateObject: Date;
  taskTitle: string;
  setTaskTitle: (value: string) => void;
  onJournalChange: (key: keyof Journal, value: string) => void;
  onSave: () => void;
  onStart: () => void;
  onFinish: () => void;
  onToggle: (id: string) => void;
  onDelete?: (id: string) => void;
  onCreateTask: (event: FormEvent) => void;
  onHistory: () => void;
  onOpenExtra?: () => void;
  enteringTaskIds?: Set<string>;
  leavingTaskIds?: Set<string>;
  blocksVisible?: boolean;
  onToggleBlocks?: () => void;
  isExiting?: boolean;
}) {
  const isDone = current.status === "completed";
  const isRetroactive = current.studyDate !== data.today;
  const topicObjectives = data.objectives.filter((objective) => objective.topicId === current.topicId);
  const lastCompleted =
    data.sessions.find(
      (session) => session.topicId === current.topicId && session.status === "completed" && session.id !== current.id,
    ) ?? null;
  return (
  <div className={`today-fades ${isExiting ? "today-fades-exiting" : ""}`}>
    <section className="today-heading"><div><p className="eyebrow"><span className="live-dot" /> {isRetroactive ? `REGISTRO RETROATIVO · ${formatDate(current.studyDate)}` : `${weekdayLong[dateObject.getDay()].toUpperCase()} · ${formatDate(data.today)}`}</p><h1>{isRetroactive ? "Registrar estudo retroativo" : "Seu foco de hoje"}</h1><p className="heading-copy">{isRetroactive ? "Registre o que estudou nessa sessão para manter seu histórico completo." : "Uma sessão de cada vez. Registre o que importa e mantenha o ritmo."}</p></div><div className="heading-actions"><button className="quiet-button" onClick={onHistory}><Icon name="clock" size={17} /> Ver histórico</button>{onOpenExtra ? <button className="extra-fab" onClick={onOpenExtra} title="Nova sessão extra ou retroativa" aria-label="Nova sessão extra ou retroativa"><Icon name="plus" size={19} /></button> : null}</div></section>
    <section className="focus-card">
      <div className="focus-orb orb-one" /><div className="focus-orb orb-two" />
      <div className="focus-content"><div className="focus-topline"><span className="focus-tag">{isRetroactive ? "REGISTRO RETROATIVO" : "TEMA DO DIA"}</span><span className="focus-topline-group"><span className={`status-chip ${statusClass(current.status)}`}><i /> {sessionLabel(current.status)}</span>{onToggleBlocks ? <button className="blocks-toggle" onClick={onToggleBlocks} aria-expanded={blocksVisible} title={blocksVisible ? "Ocultar os demais blocos" : "Mostrar os demais blocos"}><Icon name="chevron" size={13} /> {blocksVisible ? "Ocultar blocos" : "Mostrar blocos"}</button> : null}</span></div><div className="focus-body"><div><h2>{current.topicName}</h2><p>{cycle.name} <span>·</span> Dia {cycle.elapsedDays} de {cycle.durationDays}</p><div className="objective-pills">{topicObjectives.slice(0, 3).map((objective) => <span key={objective.id}>{objective.title}</span>)}</div></div><div className="focus-progress"><CircleProgress value={cycleProgress} /><span>CICLO</span></div></div></div>
      <div className="focus-footer"><div><span className="calendar-glyph"><Icon name="calendar" size={17} /></span><span>{current.status === "in_progress" ? `Iniciada às ${current.startTime ?? "agora"}` : isDone ? `Concluída · ${timeLabel(current.durationMinutes ?? 0)}` : "Planejada para hoje"}</span></div>{isDone ? <button className="finish-state"><Icon name="check" size={16} /> Sessão concluída</button> : current.status === "in_progress" ? <button className="light-action" onClick={onFinish}><Icon name="check" size={16} /> Finalizar sessão</button> : <button className="light-action" onClick={onStart}><Icon name="play" size={15} /> Começar a estudar</button>}</div>
    </section>
    <div className={`today-blocks ${blocksVisible ? "blocks-open" : "blocks-closed"}`}>
    <section className="study-grid">
      <article className="card last-study"><CardTitle kicker="CONTINUIDADE" title="Último estudo neste tema" action={<button className="card-link" onClick={onHistory}>Ver histórico <Icon name="arrow" size={15} /></button>} />
        {data.latestCompleted ? <div className="last-study-content"><div className="date-tile"><strong>{new Date(`${data.latestCompleted.studyDate}T12:00:00`).getDate()}</strong><span>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(`${data.latestCompleted.studyDate}T12:00:00`)).replace(".", "")}</span></div><div className="last-copy"><span className="session-date">{formatDate(data.latestCompleted.studyDate)} · {timeLabel(data.latestCompleted.durationMinutes ?? 0)}</span><p>{data.latestCompleted.notes || "Sem anotações desta sessão."}</p></div></div> : <div className="empty-inline"><Icon name="book" size={16} /><span>Ainda não há uma sessão concluída deste tema.</span></div>}
        <div className="next-step"><span><Icon name="arrow" size={16} /></span><div><small>PRÓXIMO PASSO</small><p>{data.latestCompleted?.nextSteps || "Comece registrando uma pequena meta para esta sessão."}</p></div></div>
      </article>
      <article className="card tasks-card"><CardTitle kicker="PENDÊNCIAS" title={`Tarefas de ${current.topicName.split(" ")[0]}`} action={<span className="task-count">{currentTasks.filter((task) => task.status !== "completed").length} abertas</span>} />
        <div className="task-list">
          {currentTasks.slice(0, 4).map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              dense
              onToggle={() => onToggle(task.id)}
              onDelete={onDelete ? () => onDelete(task.id) : undefined}
              isEntering={enteringTaskIds?.has(task.id)}
              isLeaving={leavingTaskIds?.has(task.id)}
            />
          ))}
        </div>
        <form className="quick-add" onSubmit={onCreateTask}><button type="submit" onClick={(e) => { if (!taskTitle.trim()) { e.preventDefault(); } }} aria-label="Adicionar tarefa"><Icon name="plus" size={16} /></button><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Adicionar uma tarefa rápida" /></form>
      </article>
    </section>
    <section className="journal-section"><div className="journal-heading"><div><p className="eyebrow">DIÁRIO DE ESTUDOS</p><h2>Registre sua sessão</h2><p>Escreva apenas o que for útil para você retomar com clareza.</p></div><div className={`save-indicator ${saveState}`}><span />{saveState === "saving" ? "Salvando…" : saveState === "unsaved" ? "Alterações não salvas" : "Salvo automaticamente"}<button aria-label="Salvar agora" onClick={onSave}><Icon name="save" size={16} /></button></div></div>
      <div className="journal-layout"><label className="journal-field journal-main"><span>O que fiz hoje?</span><textarea value={journal.notes} onChange={(event) => onJournalChange("notes", event.target.value)} placeholder="Descreva o que você estudou, praticou ou revisou…" /></label><div className="journal-side"><label className="journal-field"><span>O que aprendi?</span><textarea value={journal.learnings} onChange={(event) => onJournalChange("learnings", event.target.value)} placeholder="Ideias e descobertas importantes" /></label><label className="journal-field"><span>Próximos passos</span><textarea value={journal.nextSteps} onChange={(event) => onJournalChange("nextSteps", event.target.value)} placeholder="O que fica para a próxima sessão?" /></label></div></div>
      <details className="optional-notes"><summary>Adicionar dificuldades, dúvidas e observações <Icon name="chevron" size={16} /></summary><div className="optional-grid"><label className="journal-field"><span>Dificuldades</span><textarea value={journal.difficulties} onChange={(event) => onJournalChange("difficulties", event.target.value)} placeholder="O que exigiu mais atenção?" /></label><label className="journal-field"><span>Dúvidas</span><textarea value={journal.questions} onChange={(event) => onJournalChange("questions", event.target.value)} placeholder="O que vale investigar depois?" /></label></div></details>
    </section>
    </div>
  </div>
  );
}

function CyclesView({ data, createOpen, setCreateOpen, onCreate, onDelete, onSaveSchedule, onToday }: {
  data: Dashboard; createOpen: boolean; setCreateOpen: (value: boolean) => void; onCreate: (payload: CreateCyclePayload) => void; onDelete: (cycleId: string) => void; onSaveSchedule: (cycleId: string, entries: { topicId: string; weekdays: number[] }[]) => void; onToday: () => void;
}) {
  const [deleting, setDeleting] = useState<CycleSummary | null>(null);
  const [editingScheduleCycle, setEditingScheduleCycle] = useState<CycleSummary | null>(null);
  const active = data.cycles.find((cycle) => cycle.status === "active");
  const others = data.cycles.filter((cycle) => cycle.id !== active?.id);
  const livingCycles = data.cycles.filter((cycle) => cycle.status !== "cancelled");
  const multipleCycles = data.cycles.length > 1;
  const scheduleFor = (cycleId: string) => data.schedule.filter((item) => item.cycleId === cycleId);
  const daysFor = (cycleId: string) => [1, 2, 3, 4, 5, 6, 0].filter((weekday) => scheduleFor(cycleId).some((item) => item.weekday === weekday));
  const initialFor = (cycleId: string) => {
    const map: Record<string, number[]> = {};
    for (const row of scheduleFor(cycleId)) (map[row.topicId] ??= []).push(row.weekday);
    return map;
  };
  return <section className="screen-view">
    <div className="view-heading"><div><p className="eyebrow">PLANEJAMENTO</p><h1>Seus ciclos</h1><p>Períodos com propósito, temas e uma cadência que cabe na sua rotina.</p></div><button className="extra-fab" onClick={() => setCreateOpen(true)} title="Novo ciclo" aria-label="Novo ciclo"><Icon name="plus" size={19} /></button></div>
    {data.cycles.length === 0 ? <div className="empty-hero"><div className="empty-hero-icon"><Icon name="layers" size={28} /></div><h1>Nenhum ciclo por aqui</h1><p>Comece criando um ciclo com os temas que você quer dominar.</p><button className="primary-button" onClick={() => setCreateOpen(true)}><Icon name="plus" size={18} /> Criar primeiro ciclo</button></div> : <>
      {multipleCycles ? (
        <div className="cycle-grid">
          {livingCycles.map((cycle) => (
            <CycleCard key={cycle.id} cycle={cycle} rows={scheduleFor(cycle.id)} days={daysFor(cycle.id)} onOpen={onToday} onDelete={() => setDeleting(cycle)} onEditSchedule={() => setEditingScheduleCycle(cycle)} />
          ))}
        </div>
      ) : (
        <>
          {active && <FeaturedCycleCard cycle={active} metrics={data.metrics} objectivesTotal={data.objectives.length} onOpen={onToday} onDelete={() => setDeleting(active)} />}
          {others.length > 0 && <div className="cycle-grid">{others.map((cycle) => <CycleMiniCard key={cycle.id} cycle={cycle} onOpen={onToday} onDelete={() => setDeleting(cycle)} />)}</div>}
          {livingCycles.map((cycle) => {
            const rows = scheduleFor(cycle.id);
            const days = daysFor(cycle.id);
            return (
              <section key={cycle.id} className="schedule-panel">
                <CardTitle
                  kicker="ROTINA SEMANAL"
                  title={`Programação · ${cycle.name}`}
                  action={<button className="card-link" onClick={() => setEditingScheduleCycle(cycle)}><Icon name="edit" size={14} /> Editar rotina</button>}
                />
                {days.length > 0 ? (
                  <div className="schedule-list">
                    {days.map((weekday) => (
                      <div key={weekday}>
                        <span>{weekdayShort[weekday]}</span>
                        <div>
                          {rows
                            .filter((item) => item.weekday === weekday)
                            .sort((a, b) => a.position - b.position)
                            .map((item) => <b key={item.id} className={`topic-tag ${item.color}`}>{item.topicName}</b>)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-note" style={{ marginTop: 14 }}>Nenhum dia programado ainda. Clique em "Editar rotina" para definir os temas de cada dia da semana.</p>
                )}
                <p className="schedule-hint"><Icon name="calendar" size={13} /> Esta rotina convive com as demais. Segunda-feira, por exemplo, pode ter temas de vários ciclos ao mesmo tempo.</p>
              </section>
            );
          })}
        </>
      )}
    </>}
    {createOpen && <CreateCycleModal topics={data.topics} today={data.today} onClose={() => setCreateOpen(false)} onCreate={(payload) => { setCreateOpen(false); onCreate(payload); }} />}
    {editingScheduleCycle && (
      <ScheduleEditModal
        topics={data.topics}
        initial={initialFor(editingScheduleCycle.id)}
        onClose={() => setEditingScheduleCycle(null)}
        onSave={(entries) => { const id = editingScheduleCycle.id; setEditingScheduleCycle(null); onSaveSchedule(id, entries); }}
      />
    )}
    {deleting && <ConfirmModal title="Excluir ciclo" body={`O ciclo "${deleting.name}" será excluído com seus objetivos e programação. Sessões e tarefas vinculadas serão preservadas, mas sem ciclo.`} confirmLabel="Excluir ciclo" danger onClose={() => setDeleting(null)} onConfirm={() => { onDelete(deleting.id); setDeleting(null); }} />}
  </section>;
}

function FeaturedCycleCard({ cycle, metrics, objectivesTotal, onOpen, onDelete }: { cycle: CycleSummary; metrics: Dashboard["metrics"]; objectivesTotal: number; onOpen: () => void; onDelete: () => void }) {
  return <article className="cycle-card"><div className="cycle-card-top"><div className="cycle-symbol"><Icon name="layers" size={25} /></div><div className="cycle-description"><span className="active-label"><i /> EM ANDAMENTO</span><h2>{cycle.name}</h2><p>{cycle.description}</p></div><button className="delete-btn" onClick={onDelete} aria-label="Excluir ciclo"><Icon name="trash" size={15} /></button></div>
    <div className="cycle-stat-row"><div><strong>Dia {cycle.elapsedDays}</strong><span>de {cycle.durationDays} dias</span></div><div><strong>{metrics.completed}</strong><span>sessões concluídas</span></div><div><strong>{timeLabel(metrics.totalMinutes)}</strong><span>tempo estudado</span></div><div><strong>{metrics.objectivesCompleted}/{objectivesTotal}</strong><span>objetivos concluídos</span></div></div>
    <div className="wide-progress"><span style={{ width: `${cycle.progress}%` }} /></div>
    <footer><span>{formatDate(cycle.startDate)} — {formatDate(cycle.endDate)} · {cycle.progress}% do tempo previsto</span><button onClick={onOpen}>Abrir estudo de hoje <Icon name="arrow" size={15} /></button></footer>
  </article>;
}

function CycleMiniCard({ cycle, onOpen, onDelete }: { cycle: CycleSummary; onOpen: () => void; onDelete: () => void }) {
  return <article className="cycle-mini"><div className="cycle-mini-top"><span className={`cycle-status ${cycleStatusClass[cycle.status] ?? "c-planned"}`}><i /> {cycleStatusLabel[cycle.status] ?? cycle.status}</span><button className="delete-btn" onClick={onDelete} aria-label="Excluir ciclo"><Icon name="trash" size={15} /></button></div>
    <h2>{cycle.name}</h2><p className="dates">{formatDate(cycle.startDate)} — {formatDate(cycle.endDate)}</p>
    <div className="mini-stats"><div><b>{cycle.sessionsCompleted}</b>sessões</div><div><b>{timeLabel(cycle.totalMinutes)}</b>estudadas</div><div><b>{cycle.tasksPending}</b>pendências</div></div>
    <div className="wide-progress"><span style={{ width: `${cycle.progress}%` }} /></div>
    <footer className="mini-footer"><span>{cycle.progress}% · Dia {cycle.elapsedDays}/{cycle.durationDays}</span><button className="open-link" onClick={onOpen}>Estudar hoje <Icon name="arrow" size={14} /></button></footer>
  </article>;
}

function CycleCard({ cycle, rows, days, onOpen, onDelete, onEditSchedule }: {
  cycle: CycleSummary;
  rows: Dashboard["schedule"];
  days: number[];
  onOpen: () => void;
  onDelete: () => void;
  onEditSchedule: () => void;
}) {
  const [open, setOpen] = useState(false);
  const assignedDays = days.length;
  return (
    <article className="cycle-mini cycle-mini-with-accordion">
      <div className="cycle-mini-top">
        <span className={`cycle-status ${cycleStatusClass[cycle.status] ?? "c-planned"}`}><i /> {cycleStatusLabel[cycle.status] ?? cycle.status}</span>
        <button className="delete-btn" onClick={onDelete} aria-label="Excluir ciclo"><Icon name="trash" size={15} /></button>
      </div>
      <h2>{cycle.name}</h2>
      <p className="dates">{formatDate(cycle.startDate)} — {formatDate(cycle.endDate)}</p>
      <div className="mini-stats">
        <div><b>{cycle.sessionsCompleted}</b>sessões</div>
        <div><b>{timeLabel(cycle.totalMinutes)}</b>estudadas</div>
        <div><b>{cycle.tasksPending}</b>pendências</div>
      </div>
      <div className="wide-progress"><span style={{ width: `${cycle.progress}%` }} /></div>
      <footer className="mini-footer">
        <span>{cycle.progress}% · Dia {cycle.elapsedDays}/{cycle.durationDays}</span>
        <button className="open-link" onClick={onOpen}>Estudar hoje <Icon name="arrow" size={14} /></button>
      </footer>

      <div className="cycle-accordion">
        <button
          type="button"
          className="accordion-header"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
        >
          <span className="accordion-title"><Icon name="calendar" size={14} /> Rotina Semanal</span>
          <span className="accordion-info">
            {assignedDays === 0
              ? "Nenhum dia"
              : `${assignedDays} ${assignedDays === 1 ? "dia" : "dias"} programado${assignedDays === 1 ? "" : "s"}`}
          </span>
          <span className="accordion-chevron"><Icon name="chevron" size={15} /></span>
        </button>
        <div className={`accordion-body ${open ? "open" : ""}`}>
          <div className="accordion-inner">
            {days.length > 0 ? (
              <div className="schedule-list">
                {days.map((weekday) => (
                  <div key={weekday}>
                    <span>{weekdayShort[weekday]}</span>
                    <div>
                      {rows
                        .filter((item) => item.weekday === weekday)
                        .sort((a, b) => a.position - b.position)
                        .map((item) => <b key={item.id} className={`topic-tag ${item.color}`}>{item.topicName}</b>)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-note">Nenhum dia programado ainda.</p>
            )}
          </div>
        </div>
      </div>

      <button className="edit-schedule-corner" onClick={onEditSchedule}>
        <Icon name="edit" size={13} /> Editar rotina
      </button>
    </article>
  );
}

function CreateCycleModal({ topics, today, onClose, onCreate }: { topics: TopicItem[]; today: string; onClose: () => void; onCreate: (payload: CreateCyclePayload) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // "Hoje" da plataforma (relógio simulado quando ativo), não a data do navegador.
  const [startDate, setStartDate] = useState(today);
  const [duration, setDuration] = useState(90);
  const [selected, setSelected] = useState<string[]>([]);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopics, setNewTopics] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<Record<string, number[]>>({});

  const toggleWeekday = (key: string, weekday: number) => setSchedule((previous) => {
    const current = previous[key] ?? [];
    return { ...previous, [key]: current.includes(weekday) ? current.filter((item) => item !== weekday) : [...current, weekday].sort() };
  });

  const toggleTopic = (id: string) => setSelected((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);

  const addNewTopic = () => {
    const value = newTopicName.trim();
    if (!value) return;
    const key = `new:${newTopics.length}`;
    setNewTopics((previous) => [...previous, value]);
    setSelected((previous) => [...previous, key]);
    setNewTopicName("");
  };

  const submit = () => {
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      description,
      startDate,
      durationDays: duration || 90,
      topics: selected.map((id) => id.startsWith("new:") ? { name: newTopics[Number(id.slice(4))] } : { id }),
      schedule: selected.map((id, index) => ({ topicIndex: index, weekdays: schedule[id] ?? [] })),
    });
  };

  return <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-card" role="dialog" aria-modal="true" aria-label="Novo ciclo de estudos">
      <div className="modal-header"><div><h2>Novo ciclo de estudos</h2><p>Defina o período, os temas e a cadência semanal.</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button></div>
      <div className="modal-body">
        <div className="form-grid two">
          <label className="field span2"><span>Nome do ciclo *</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Redes de Distribuição Aérea" /></label>
          <label className="field span2"><span>Descrição</span><textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Qual é o propósito deste ciclo?" /></label>
          <label className="field"><span>Início</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="field"><span>Duração (dias)</span><input type="number" min={7} max={365} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
        </div>
        <div className="modal-block"><h3>Temas participantes</h3><p>Escolha entre temas já cadastrados ou crie novos.</p>
          <div className="topic-pick-list">{topics.map((topic) => <button key={topic.id} className={`topic-pick ${selected.includes(topic.id) ? "on" : ""}`} onClick={() => toggleTopic(topic.id)}><span className={`topic-icon ${topic.color}`}><Icon name="book" size={15} /></span>{topic.name}<i>{selected.includes(topic.id) && <Icon name="check" size={13} stroke={3} />}</i></button>)}</div>
          <div className="new-topic-row"><input value={newTopicName} onChange={(event) => setNewTopicName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addNewTopic(); } }} placeholder="Nome do novo tema…" /><button onClick={addNewTopic} aria-label="Adicionar tema"><Icon name="plus" size={15} /></button></div>
          {newTopics.length > 0 && <div className="new-topic-chips">{newTopics.map((item, index) => { const key = `new:${index}`; return <span key={key} className={`topic-pick ${selected.includes(key) ? "on" : "off"}`}>{item}<button onClick={() => toggleTopic(key)} aria-label="Remover tema">×</button></span>; })}</div>}
        </div>
        <div className="modal-block"><h3>Programação semanal</h3><p>Marque os dias de estudo de cada tema selecionado.</p>
          {selected.length === 0 ? <p className="muted-note">Selecione ao menos um tema para montar a programação.</p> : <div className="weekday-list">{selected.map((id) => { const label = id.startsWith("new:") ? newTopics[Number(id.slice(4))] : (topics.find((topic) => topic.id === id)?.name ?? "Tema"); return <div key={id} className="weekday-row"><span>{label}</span><div>{[1, 2, 3, 4, 5, 6, 0].map((weekday) => <button key={weekday} className={`weekday-btn ${(schedule[id] ?? []).includes(weekday) ? "on" : ""}`} onClick={() => toggleWeekday(id, weekday)}>{weekdayShort[weekday]}</button>)}</div></div>; })}</div>}
        </div>
      </div>
      <div className="modal-footer"><button className="ghost-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!name.trim()} onClick={submit}><Icon name="check" size={16} /> Criar ciclo</button></div>
    </div>
  </div>;
}

function ScheduleEditModal({
  topics,
  initial,
  onClose,
  onSave,
}: {
  topics: TopicItem[];
  initial: Record<string, number[]>;
  onClose: () => void;
  onSave: (entries: { topicId: string; weekdays: number[] }[]) => void;
}) {
  const [days, setDays] = useState<Record<string, number[]>>(initial);

  const toggle = (topicId: string, weekday: number) =>
    setDays((previous) => {
      const currentDays = previous[topicId] ?? [];
      return {
        ...previous,
        [topicId]: currentDays.includes(weekday)
          ? currentDays.filter((item) => item !== weekday)
          : [...currentDays, weekday].sort((a, b) => a - b),
      };
    });

  const totalAssignments = Object.values(days).reduce((sum, list) => sum + list.length, 0);

  const submit = () => {
    onSave(
      Object.entries(days)
        .filter(([, weekdays]) => weekdays.length > 0)
        .map(([topicId, weekdays]) => ({ topicId, weekdays })),
    );
  };

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Editar rotina semanal">
        <div className="modal-header">
          <div>
            <h2>Editar rotina semanal</h2>
            <p>Marque ou desmarque os dias de cada tema. O calendário é atualizado a partir de hoje.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          {topics.length === 0 ? (
            <p className="muted-note">Nenhum tema cadastrado ainda. Crie temas para montar a rotina.</p>
          ) : (
            <div className="weekday-list schedule-edit-list">
              {topics.map((topic) => {
                const selectedDays = days[topic.id] ?? [];
                return (
                  <div key={topic.id} className="weekday-row">
                    <span className="schedule-edit-topic">
                      <i className={`group-dot ${topic.color}`} />
                      {topic.name}
                    </span>
                    <div>
                      {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                        <button
                          key={weekday}
                          type="button"
                          className={`weekday-btn ${selectedDays.includes(weekday) ? "on" : ""}`}
                          onClick={() => toggle(topic.id, weekday)}
                        >
                          {weekdayShort[weekday]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="schedule-hint" style={{ marginTop: 14 }}>
            <Icon name="bolt" size={13} /> {totalAssignments === 0
              ? "Sem dias marcados: salvar deixará o ciclo sem sessões planejadas no futuro."
              : `${totalAssignments} ${totalAssignments === 1 ? "dia atribuído" : "dias atribuídos"}. Sessões passadas e registros concluídos nunca são alterados.`}
          </p>
        </div>
        <div className="modal-footer">
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
          <button className="primary-button" onClick={submit}>
            <Icon name="check" size={16} /> Salvar rotina
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, danger, onClose, onConfirm }: { title: string; body: string; confirmLabel: string; danger?: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-card confirm-card" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="confirm-icon"><Icon name="trash" size={20} /></div><h2>{title}</h2><p>{body}</p>
      <div className="modal-footer"><button className="ghost-button" onClick={onClose}>Cancelar</button><button className={danger ? "danger-button" : "primary-button"} onClick={onConfirm}>{confirmLabel}</button></div>
    </div>
  </div>;
}

function ProfileModal({
  user,
  today,
  sessionToken,
  fetcher,
  onSaveSystemTime,
  onClose,
}: {
  user: Dashboard["user"];
  today: string;
  sessionToken: string | null;
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onSaveSystemTime: (studyDate: string, startTime: string) => Promise<void>;
  onClose: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  // O relógio central já resolve a hora "agora" da plataforma; o frontend apenas
  // a exibe e usa como ponto de partida para os campos de data/hora.
  const platformNow = () => new Date(user.clockNow || new Date());
  const localDate = (date = platformNow()) => localIsoDate(date);
  const localTime = (date = platformNow()) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const [simDate, setSimDate] = useState(localDate());
  const [simTime, setSimTime] = useState(localTime());
  const [computerTick, setComputerTick] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const d = platformNow();
    setSimDate(localDate(d));
    setSimTime(localTime(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.clockNow]);

  useEffect(() => {
    if (!simulationOpen) return;
    const id = setInterval(() => setComputerTick(new Date()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationOpen]);

  const roleLabel = user.role === "admin" ? "Administrador" : "Usuário";
  const hasSystemOverride = user.clockMode === "simulated";
  const currentSystemDate = localDate();
  const currentSystemTime = localTime();
  const computerDate = localIsoDate(computerTick);
  const computerTime = `${String(computerTick.getHours()).padStart(2, "0")}:${String(computerTick.getMinutes()).padStart(2, "0")}:${String(computerTick.getSeconds()).padStart(2, "0")}`;

  const handleApplySimulation = async () => {
    if (busy) return;
    if (!simDate || !simTime) {
      setMessage({ text: "Preencha a data e a hora antes de aplicar.", ok: false });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await onSaveSystemTime(simDate, simTime);
      setMessage({ text: "Horário do sistema atualizado.", ok: true });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Não foi possível aplicar a configuração de horário.", ok: false });
    } finally {
      setBusy(false);
    }
  };

  const syncWithComputer = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await onSaveSystemTime("", "");
      setMessage({ text: "Horário sincronizado com o computador.", ok: true });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Não foi possível sincronizar com o computador.", ok: false });
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async () => {
    setMessage(null);
    if (!currentPassword) { setMessage({ text: "Informe a senha atual.", ok: false }); return; }
    if (newPassword.length < 8) { setMessage({ text: "A nova senha precisa ter pelo menos 8 caracteres.", ok: false }); return; }
    if (newPassword !== confirmPassword) { setMessage({ text: "A confirmação não corresponde à nova senha.", ok: false }); return; }
    setBusy(true);
    try {
      const response = await fetcher("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, sessionToken }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (response.ok && data.ok) {
        setMessage({ text: data.message ?? "Senha alterada com sucesso.", ok: true });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setMessage({ text: data.message ?? "Não foi possível alterar a senha.", ok: false });
      }
    } catch {
      setMessage({ text: "Falha de conexão. Tente novamente.", ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="modal-card profile-card" role="dialog" aria-modal="true" aria-label="Perfil do usuário" aria-busy={busy}>
        <div className="modal-header">
          <div>
            <h2>Minha conta</h2>
            <p>Informações da conta e alteração de senha.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Fechar"><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          <div className="profile-info">
            <div className="profile-avatar">{initialsOf(user.name)}</div>
            <div className="profile-details">
              <h3>{user.name}</h3>
              <p>{user.email}</p>
              <span className={`profile-role ${user.role}`}>
                <Icon name={user.role === "admin" ? "bolt" : "book"} size={13} /> {roleLabel}
              </span>
            </div>
          </div>

          {user.role === "admin" ? (
            <>
              <button
                type="button"
                className="profile-accordion"
                onClick={() => {
                  setSimulationOpen((previous) => !previous);
                  setMessage(null);
                }}
                aria-expanded={simulationOpen}
              >
                <span className="profile-accordion-title">
                  <Icon name="clock" size={15} /> Simular horário
                </span>
                <span className="profile-accordion-chevron"><Icon name="chevron" size={15} /></span>
              </button>
              <div className={`profile-accordion-body ${simulationOpen ? "open" : ""}`}>
                <div className="profile-accordion-inner">
                  <div className="profile-sim-form">
                    <div className="profile-time-duo">
                      <div className="profile-current-time">
                        <span className="profile-current-time-icon"><Icon name="clock" size={16} /></span>
                        <div>
                          <small>Agora na plataforma</small>
                          <strong>{weekdayLong[new Date(`${currentSystemDate}T12:00:00`).getDay()]}, {formatDate(currentSystemDate)}{currentSystemTime ? ` às ${currentSystemTime}` : ""}</strong>
                          <p>{hasSystemOverride ? "Horário simulado definido na plataforma." : "Segue o horário real do computador."}</p>
                        </div>
                      </div>
                      <div className="profile-current-time computer">
                        <span className="profile-current-time-icon computer"><Icon name="bolt" size={16} /></span>
                        <div>
                          <small>Hora real do computador</small>
                          <strong>{weekdayLong[computerTick.getDay()]}, {formatDate(computerDate)} às {computerTime}</strong>
                          <p>Relógio do seu dispositivo, atualizado ao vivo.</p>
                        </div>
                      </div>
                    </div>

                    <div className="retro-fields profile-set-time-fields">
                      <label className="field">
                        <span>Definir data do sistema</span>
                        <input type="date" value={simDate} disabled={busy} onChange={(event) => setSimDate(event.target.value)} />
                      </label>
                      <label className="field">
                        <span>Definir hora do sistema</span>
                        <input type="time" value={simTime} disabled={busy} onChange={(event) => setSimTime(event.target.value)} />
                      </label>
                    </div>

                    <div className="profile-sim-actions">
                      <button type="button" className="profile-sim-btn sync" onClick={() => void syncWithComputer()} disabled={busy}>
                        <span><Icon name="bolt" size={14} /></span>
                        <div>
                          <strong>Sincronizar</strong>
                          <small>Usar horário do computador</small>
                        </div>
                      </button>
                      <button type="button" className="profile-sim-btn apply" onClick={() => void handleApplySimulation()} disabled={busy}>
                        <span><Icon name="check" size={15} /></span>
                        <div>
                          <strong>{busy ? "Aplicando…" : "Setar horário"}</strong>
                          <small>Usar data e hora acima</small>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          <div className="profile-divider" />

          <button
            type="button"
            className="profile-accordion"
            onClick={() => {
              setPasswordOpen((previous) => !previous);
              setMessage(null);
            }}
            aria-expanded={passwordOpen}
          >
            <span className="profile-accordion-title">
              <Icon name="lock" size={15} /> Alterar senha
            </span>
            <span className="profile-accordion-chevron"><Icon name="chevron" size={15} /></span>
          </button>
          <div className={`profile-accordion-body ${passwordOpen ? "open" : ""}`}>
            <div className="profile-accordion-inner">
              <div className="profile-password-form">
                <label className="field">
                  <span>Senha atual</span>
                  <div className="auth-password">
                    <input
                      type={showCurrent ? "text" : "password"}
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      placeholder="Sua senha atual"
                      autoComplete="current-password"
                    />
                    <button type="button" onClick={() => setShowCurrent((previous) => !previous)} aria-label={showCurrent ? "Ocultar" : "Mostrar"}>
                      <Icon name={showCurrent ? "close" : "spark"} size={15} />
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>Nova senha</span>
                  <div className="auth-password">
                    <input
                      type={showNew ? "text" : "password"}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="Mínimo de 8 caracteres"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowNew((previous) => !previous)} aria-label={showNew ? "Ocultar" : "Mostrar"}>
                      <Icon name={showNew ? "close" : "spark"} size={15} />
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>Confirmar nova senha</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repita a nova senha"
                    autoComplete="new-password"
                  />
                </label>
              </div>
            </div>
          </div>

          {message ? (
            <p className={`profile-msg ${message.ok ? "ok" : "err"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>Fechar</button>
          {passwordOpen ? (
            <button className="primary-button" onClick={handleChangePassword} disabled={busy}>
              <Icon name="save" size={15} /> {busy ? "Salvando…" : "Salvar nova senha"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ExtraSessionModal({
  topics,
  today,
  onClose,
  onCreate,
}: {
  topics: TopicItem[];
  today: string;
  onClose: () => void;
  onCreate: (topicId: string, options: { studyDate?: string; startTime?: string; endTime?: string }) => void;
}) {
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [retroactive, setRetroactive] = useState(false);
  // "Hoje" da plataforma (relógio simulado quando ativo), não a data do navegador.
  const [studyDate, setStudyDate] = useState(today);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const submit = () => {
    if (!selectedTopic) return;
    onCreate(selectedTopic, {
      studyDate: retroactive ? studyDate : undefined,
      startTime: retroactive ? startTime : undefined,
      endTime: retroactive ? endTime : undefined,
    });
  };

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Nova sessão de estudo">
        <div className="modal-header"><div><h2>Nova sessão de estudo</h2><p>Escolha um tema para começar, como no dia livre.</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button></div>
        <div className="modal-body">
          <div className="modal-block">
            <h3>Escolha um tema para estudar</h3>
            <p>Selecione o tema da sessão que deseja registrar.</p>
            <div className="topic-pick-list">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  className={`topic-pick ${selectedTopic === topic.id ? "on" : ""}`}
                  onClick={() => setSelectedTopic(topic.id)}
                >
                  <span className={`topic-icon ${topic.color}`}><Icon name="book" size={15} /></span>
                  {topic.name}
                  <i>{selectedTopic === topic.id && <Icon name="check" size={13} stroke={3} />}</i>
                </button>
              ))}
            </div>
          </div>
          <label className="retro-check">
            <input type="checkbox" checked={retroactive} onChange={(event) => setRetroactive(event.target.checked)} />
            <span>Retroativo?</span>
            <small>Registrar estudo de um dia anterior</small>
          </label>
          {retroactive ? (
            <div className="retro-fields">
              <label className="field">
                <span>Data do estudo</span>
                <input type="date" value={studyDate} max={today} onChange={(event) => setStudyDate(event.target.value)} />
              </label>
              <label className="field">
                <span>Início</span>
                <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
              </label>
              <label className="field">
                <span>Fim</span>
                <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
              </label>
            </div>
          ) : null}
        </div>
        <div className="modal-footer">
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
          <button className="primary-button" disabled={!selectedTopic} onClick={submit}>
            <Icon name={retroactive ? "clock" : "play"} size={16} /> {retroactive ? "Registrar estudo" : "Iniciar sessão"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionDetailModal({
  session,
  data,
  onClose,
  onSave,
}: {
  session: StudySession;
  data: Dashboard;
  onClose: () => void;
  onSave: (sessionId: string, values: Record<string, unknown>) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notes, setNotes] = useState(session.notes ?? "");
  const [learnings, setLearnings] = useState(session.learnings ?? "");
  const [nextSteps, setNextSteps] = useState(session.nextSteps ?? "");
  const [difficulties, setDifficulties] = useState(session.difficulties ?? "");
  const [questions, setQuestions] = useState(session.questions ?? "");
  const [startTime, setStartTime] = useState(session.startTime ?? "");
  const [endTime, setEndTime] = useState(session.endTime ?? "");
  const [durationMinutes, setDurationMinutes] = useState(session.durationMinutes ?? 0);

  useEffect(() => {
    setNotes(session.notes ?? "");
    setLearnings(session.learnings ?? "");
    setNextSteps(session.nextSteps ?? "");
    setDifficulties(session.difficulties ?? "");
    setQuestions(session.questions ?? "");
    setStartTime(session.startTime ?? "");
    setEndTime(session.endTime ?? "");
    setDurationMinutes(session.durationMinutes ?? 0);
  }, [session]);

  const handleCancel = () => {
    setNotes(session.notes ?? "");
    setLearnings(session.learnings ?? "");
    setNextSteps(session.nextSteps ?? "");
    setDifficulties(session.difficulties ?? "");
    setQuestions(session.questions ?? "");
    setStartTime(session.startTime ?? "");
    setEndTime(session.endTime ?? "");
    setDurationMinutes(session.durationMinutes ?? 0);
    setIsEditing(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    let calculated = durationMinutes;
    if (startTime && endTime) {
      const [sH, sM] = startTime.split(":").map(Number);
      const [eH, eM] = endTime.split(":").map(Number);
      const diff = eH * 60 + eM - (sH * 60 + sM);
      if (diff > 0) calculated = diff;
    }
    await onSave(session.id, {
      notes,
      learnings,
      nextSteps,
      difficulties,
      questions,
      startTime: startTime || null,
      endTime: endTime || null,
      durationMinutes: calculated,
    });
    setIsSaving(false);
    setIsEditing(false);
  };

  const cycleProgress = data.cycle ? Math.round((data.cycle.elapsedDays / data.cycle.durationDays) * 100) : 0;
  const topicObjectives = data.objectives.filter((o) => o.topicId === session.topicId);
  const sessionTasks = data.tasks.filter((t) => t.topicId === session.topicId || t.sessionId === session.id);

  // Find earlier completed session of this topic
  const priorSession = data.sessions.find(
    (s) => s.topicId === session.topicId && s.status === "completed" && s.studyDate < session.studyDate && s.id !== session.id
  );

  return (
    <div
      className="modal-overlay session-detail-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isEditing && !isSaving) onClose();
      }}
    >
      <div className="modal-card session-detail-card" role="dialog" aria-modal="true" aria-label="Detalhes da sessão">
        <header className="session-detail-header">
          <div>
            <p className="eyebrow">
              <span className="live-dot" /> REGISTRO DE ESTUDO · {formatDate(session.studyDate).toUpperCase()}
            </p>
            <h2>{session.topicName}</h2>
          </div>
          <div className="session-detail-actions">
            {!isEditing ? (
              <>
                <button type="button" className="quiet-button" onClick={() => setIsEditing(true)}>
                  <Icon name="edit" size={14} /> Editar sessão
                </button>
                <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
                  <Icon name="close" size={18} />
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ghost-button" onClick={handleCancel} disabled={isSaving}>
                  Cancelar
                </button>
                <button type="button" className="primary-button" onClick={handleSave} disabled={isSaving}>
                  <Icon name="save" size={15} /> {isSaving ? "Salvando…" : "Salvar alterações"}
                </button>
              </>
            )}
          </div>
        </header>

        <div className="session-detail-body">
          {/* Bloco 1 — Tema do Dia */}
          <section className="focus-card">
            <div className="focus-orb orb-one" />
            <div className="focus-orb orb-two" />
            <div className="focus-content">
              <div className="focus-topline">
                <span className="focus-tag">TEMA DO DIA · SESSÃO CONCLUÍDA</span>
                <span className="status-chip status-completed">
                  <i /> Concluída
                </span>
              </div>
              <div className="focus-body">
                <div>
                  <h2>{session.topicName}</h2>
                  <p>
                    {data.cycle?.name ?? "Ciclo de estudos"} <span>·</span> {formatDate(session.studyDate)}
                  </p>
                  <div className="objective-pills">
                    {topicObjectives.slice(0, 4).map((obj) => (
                      <span key={obj.id}>{obj.title}</span>
                    ))}
                  </div>
                </div>
                <div className="focus-progress">
                  <CircleProgress value={cycleProgress} />
                  <span>CICLO</span>
                </div>
              </div>
            </div>
            <div className="focus-footer">
              <div>
                <span className="calendar-glyph">
                  <Icon name="calendar" size={17} />
                </span>
                <span>
                  {session.startTime && session.endTime
                    ? `Horário: ${session.startTime} às ${session.endTime} · `
                    : session.startTime
                    ? `Iniciada às ${session.startTime} · `
                    : ""}
                  Duração: {timeLabel(durationMinutes || session.durationMinutes || 0)}
                </span>
              </div>
              {isEditing ? (
                <div className="session-edit-times">
                  <label>
                    <span>Início</span>
                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </label>
                  <label>
                    <span>Fim</span>
                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </label>
                </div>
              ) : null}
            </div>
          </section>

          {/* Grid com Continuidade e Pendências */}
          <div className="study-grid">
            {/* Bloco 2 — Continuidade */}
            <article className="card last-study">
              <CardTitle kicker="CONTINUIDADE" title="Último estudo neste tema" />
              {priorSession ? (
                <div className="last-study-content">
                  <div className="date-tile">
                    <strong>{new Date(`${priorSession.studyDate}T12:00:00`).getDate()}</strong>
                    <span>
                      {new Intl.DateTimeFormat("pt-BR", { month: "short" })
                        .format(new Date(`${priorSession.studyDate}T12:00:00`))
                        .replace(".", "")}
                    </span>
                  </div>
                  <div className="last-copy">
                    <span className="session-date">
                      {formatDate(priorSession.studyDate)} · {timeLabel(priorSession.durationMinutes ?? 0)}
                    </span>
                    <p>{priorSession.notes || "Sem anotações registradas nesta sessão anterior."}</p>
                  </div>
                </div>
              ) : (
                <Empty text="Primeira sessão concluída deste tema no histórico." />
              )}
              <div className="next-step">
                <span>
                  <Icon name="arrow" size={16} />
                </span>
                <div>
                  <small>PRÓXIMO PASSO REGISTRADO</small>
                  <p>{isEditing ? nextSteps || "Defina o próximo passo abaixo." : session.nextSteps || "Nenhum próximo passo registrado."}</p>
                </div>
              </div>
            </article>

            {/* Bloco 3 — Pendências */}
            <article className="card tasks-card">
              <CardTitle
                kicker="PENDÊNCIAS"
                title={`Tarefas de ${session.topicName.split(" ")[0]}`}
                action={<span className="task-count">{sessionTasks.length} tarefas</span>}
              />
              <div className="task-list">
                {sessionTasks.length === 0 ? (
                  <Empty text="Nenhuma tarefa vinculada a este tema." />
                ) : (
                  sessionTasks.slice(0, 5).map((task) => (
                    <div key={task.id} className={`task-row ${task.status === "completed" ? "task-done" : ""}`}>
                      <div className={`checkbox ${task.status === "completed" ? "checked" : ""}`}>
                        {task.status === "completed" && <Icon name="check" size={12} stroke={3} />}
                      </div>
                      <div className="task-main">
                        <p>{task.title}</p>
                        <span>{task.status === "completed" ? "Concluída" : "Em aberto"}</span>
                      </div>
                      <i className={`priority priority-${task.priority}`} />
                    </div>
                  ))
                )}
              </div>
            </article>
          </div>

          {/* Bloco 4 — Diário de Estudos */}
          <section className="journal-section">
            <div className="journal-heading">
              <div>
                <p className="eyebrow">DIÁRIO DE ESTUDOS</p>
                <h2>Registros da sessão</h2>
                <p>
                  {isEditing
                    ? "Edite os registros desta sessão e clique em salvar alterações."
                    : "Registros realizados nesta sessão de estudo."}
                </p>
              </div>
            </div>

            {!isEditing ? (
              <div className="journal-display-wrapper">
                <div className="journal-display-block main">
                  <h4>O que fiz nesta sessão?</h4>
                  <p>{session.notes ? session.notes : <span className="empty-text">Nenhum registro adicionado.</span>}</p>
                </div>
                <div className="journal-display-grid">
                  <div className="journal-display-block">
                    <h4>O que aprendi?</h4>
                    <p>{session.learnings ? session.learnings : <span className="empty-text">Nenhum aprendizado registrado.</span>}</p>
                  </div>
                  <div className="journal-display-block">
                    <h4>Próximos passos</h4>
                    <p>{session.nextSteps ? session.nextSteps : <span className="empty-text">Nenhum próximo passo registrado.</span>}</p>
                  </div>
                  <div className="journal-display-block">
                    <h4>Dificuldades</h4>
                    <p>{session.difficulties ? session.difficulties : <span className="empty-text">Nenhuma dificuldade informada.</span>}</p>
                  </div>
                  <div className="journal-display-block">
                    <h4>Dúvidas</h4>
                    <p>{session.questions ? session.questions : <span className="empty-text">Nenhuma dúvida informada.</span>}</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="journal-layout">
                  <label className="journal-field journal-main">
                    <span>O que fiz hoje?</span>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Descreva o que você estudou nesta sessão…" />
                  </label>
                  <div className="journal-side">
                    <label className="journal-field">
                      <span>O que aprendi?</span>
                      <textarea value={learnings} onChange={(e) => setLearnings(e.target.value)} placeholder="Ideias e aprendizados" />
                    </label>
                    <label className="journal-field">
                      <span>Próximos passos</span>
                      <textarea value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} placeholder="Próximos passos" />
                    </label>
                  </div>
                </div>
                <div className="optional-grid" style={{ marginTop: "16px" }}>
                  <label className="journal-field">
                    <span>Dificuldades</span>
                    <textarea value={difficulties} onChange={(e) => setDifficulties(e.target.value)} placeholder="Dificuldades encontradas…" />
                  </label>
                  <label className="journal-field">
                    <span>Dúvidas</span>
                    <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} placeholder="Dúvidas para pesquisar…" />
                  </label>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CardTitle({ kicker, title, action }: { kicker: string; title: string; action?: React.ReactNode }) { return <header className="card-title"><div><p>{kicker}</p><h2>{title}</h2></div>{action}</header>; }
function Empty({ text }: { text: string }) { return <div className="empty"><span><Icon name="book" size={18} /></span><p>{text}</p></div>; }
function CircleProgress({ value }: { value: number }) { const r = 26; const c = 2 * Math.PI * r; return <div className="circle-progress"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r={r} /><circle className="circle-value" cx="32" cy="32" r={r} strokeDasharray={c} strokeDashoffset={c - (value / 100) * c} /></svg><strong>{value}%</strong></div>; }

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function elapsedBetween(start: string, end: string | null) {
  if (!end) return "Em aberto";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
}

function formatShortDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(value));
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  dense = false,
  isEntering = false,
  isLeaving = false,
}: {
  task: Task;
  onToggle: () => void;
  onDelete?: () => void;
  dense?: boolean;
  isEntering?: boolean;
  isLeaving?: boolean;
}) {
  const completed = task.status === "completed";
  return (
    <div
      className={`task-row ${completed ? "task-done" : ""} ${dense ? "task-dense" : "task-rich"} ${
        isEntering ? "task-entering" : ""
      } ${isLeaving ? "task-leaving" : ""}`}
    >
      <button className="checkbox" onClick={onToggle} aria-label={completed ? "Reabrir tarefa" : "Concluir tarefa"}>
        {completed && <Icon name="check" size={13} stroke={3} />}
      </button>
      <div className="task-main">
        <p>{task.title}</p>
        {dense ? (
          <span>{completed ? `Concluída em ${formatShortDate(task.completedAt)}` : `Aberta em ${formatShortDate(task.createdAt)}`}</span>
        ) : (
          <div className="task-meta-grid">
            <span><b>Abertura</b>{formatDateTime(task.createdAt)}</span>
            <span><b>Conclusão</b>{completed ? formatDateTime(task.completedAt) : "Em aberto"}</span>
            <span><b>Tempo</b>{elapsedBetween(task.createdAt, task.completedAt)}</span>
          </div>
        )}
      </div>
      <div className="task-row-actions">
        <i
          className={`priority priority-${task.priority}`}
          title={`Prioridade ${task.priority === "high" ? "alta" : task.priority === "low" ? "baixa" : "média"}`}
        />
        {onDelete ? (
          <button className="delete-btn task-delete" onClick={onDelete} aria-label="Excluir tarefa">
            <Icon name="trash" size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CalendarView({
  data,
  month,
  setMonth,
  selectedDay,
  setSelectedDay,
  onInspectSession,
}: {
  data: Dashboard;
  month: Date;
  setMonth: (value: Date) => void;
  selectedDay: string | null;
  setSelectedDay: (value: string | null) => void;
  onInspectSession: (session: StudySession) => void;
}) {
  const cursor = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(cursor);
  const gridStart = new Date(cursor);
  gridStart.setDate(1 - cursor.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
  const selectedSessions = selectedDay ? data.sessions.filter((session) => session.studyDate === selectedDay) : [];
  return (
    <section className="screen-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">VISÃO GERAL</p>
          <h1>Calendário de estudos</h1>
          <p>Acompanhe o planejado, o realizado e qualquer alteração de rota.</p>
        </div>
        <div className="legend">
          <span><i className="dot planned" />Planejada</span>
          <span><i className="dot complete" />Concluída</span>
          <span><i className="dot missed" />Não realizada</span>
        </div>
      </div>
      <div className="calendar-card">
        <div className="calendar-toolbar">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <h2>{monthLabel}</h2>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
        </div>
        <div className="calendar-weekdays">
          {weekdayShort.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {days.map((day) => {
            const iso = localIsoDate(day);
            const events = data.sessions.filter((session) => session.studyDate === iso);
            const visibleEvents = events.slice(0, 2);
            const hiddenCount = Math.max(0, events.length - visibleEvents.length);
            const isToday = iso === data.today;
            return (
              <button
                key={iso}
                className={`calendar-day ${day.getMonth() !== month.getMonth() ? "other-month" : ""} ${
                  isToday ? "is-today" : ""
                } ${selectedDay === iso ? "selected" : ""}`}
                onClick={() => setSelectedDay(selectedDay === iso ? null : iso)}
              >
                <span>{day.getDate()}</span>
                <div className="calendar-event-stack">
                  {visibleEvents.map((event) => (
                    <small className={statusClass(event.status)} key={event.id} title={`${event.topicName}${event.cycleName ? ` · ${event.cycleName}` : ""}`}>
                      {event.topicName.split(" ")[0]}
                    </small>
                  ))}
                  {hiddenCount > 0 ? <small className="calendar-more">+{hiddenCount}</small> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {selectedDay && (
        <section className="selected-events">
          <h2>{weekdayLong[new Date(`${selectedDay}T12:00:00`).getDay()]}, {formatDate(selectedDay)}</h2>
          {selectedSessions.length ? (
            selectedSessions.map((session) => (
              <div key={session.id} className="history-row">
                <span className={`history-status ${statusClass(session.status)}`} />
                <div>
                  <strong>{session.topicName}</strong>
                  <p>
                    {sessionLabel(session.status)} {session.isExtra ? "· sessão extra" : ""}{session.cycleName ? ` · ${session.cycleName}` : ""}
                  </p>
                </div>
                <div className="calendar-session-side">
                  <span>{session.durationMinutes ? timeLabel(session.durationMinutes) : ""}</span>
                  {session.status === "completed" ? (
                    <button
                      type="button"
                      className="calendar-clock-btn"
                      onClick={() => onInspectSession(session)}
                      title="Ver registro completo deste estudo"
                      aria-label="Ver registro completo deste estudo"
                    >
                      <Icon name="clock" size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="calendar-empty-inline">
              <Icon name="calendar" size={15} />
              <span>Não há sessões registradas nesta data.</span>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function progressStatus(progress: number): Objective["status"] {
  return progress >= 100 ? "completed" : progress > 0 ? "in_progress" : "not_started";
}

function ObjectiveProgressSlider({
  objective,
  onCommit,
}: {
  objective: Objective;
  onCommit: (progress: number, status: Objective["status"]) => void;
}) {
  const [value, setValue] = useState(objective.progress);
  const lastCommitted = useRef(objective.progress);

  useEffect(() => {
    setValue(objective.progress);
    lastCommitted.current = objective.progress;
  }, [objective.progress]);

  const commit = (raw: number) => {
    const progress = Math.max(0, Math.min(100, Math.round(raw)));
    setValue(progress);
    if (progress === lastCommitted.current) return;
    lastCommitted.current = progress;
    onCommit(progress, progressStatus(progress));
  };

  return (
    <div className="obj-progress-control">
      <input
        type="range"
        className="obj-progress-slider"
        min={0}
        max={100}
        step={1}
        value={value}
        style={{ background: `linear-gradient(90deg, #645bd9 0%, #9389f0 ${value}%, #e8e8f7 ${value}%, #e8e8f7 100%)` }}
        onChange={(event) => setValue(Number(event.target.value))}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => commit(Number(event.currentTarget.value))}
        onBlur={(event) => commit(Number(event.currentTarget.value))}
        aria-label={`Progresso do objetivo ${objective.title}`}
        aria-valuetext={`${value}%`}
        title={`Arraste para definir o progresso: ${value}%`}
      />
      <span className="obj-pct">{value}%</span>
    </div>
  );
}

function TopicsView({
  data,
  onCreateObjective,
  onUpdateObjective,
  onDeleteObjective,
  onCreateTopic,
  onDeleteTopic,
  onUpdateTopic,
}: {
  data: Dashboard;
  onCreateObjective: (topicId: string, title: string) => void;
  onUpdateObjective: (objectiveId: string, values: { title?: string; progress?: number; status?: string }) => void;
  onDeleteObjective: (objectiveId: string) => void;
  onCreateTopic: (payload: { topicName: string; topicDescription: string; topicColor: string }) => void;
  onDeleteTopic: (topicId: string) => void;
  onUpdateTopic: (topicId: string, payload: { topicName: string; topicDescription: string }) => void;
}) {
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);
  const [newObjTitle, setNewObjTitle] = useState("");
  const [deletingObj, setDeletingObj] = useState<Objective | null>(null);
  const [createTopicOpen, setCreateTopicOpen] = useState(false);
  const [deletingTopic, setDeletingTopic] = useState<TopicItem | null>(null);
  // Menu de ações do card e edição de tema.
  const [menuTopicId, setMenuTopicId] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState<TopicItem | null>(null);
  // Renomeação inline: id do objetivo em edição + rascunho do título.
  const [editingObjId, setEditingObjId] = useState<string | null>(null);
  const [objDraft, setObjDraft] = useState("");
  const editingObjRef = useRef<string | null>(null);
  const objInputRef = useRef<HTMLInputElement | null>(null);

  // Foco e seleção do texto assim que a edição abre.
  useEffect(() => {
    if (editingObjId && objInputRef.current) {
      objInputRef.current.focus();
      objInputRef.current.select();
    }
  }, [editingObjId]);

  const startObjEdit = (obj: Objective) => {
    editingObjRef.current = obj.id;
    setEditingObjId(obj.id);
    setObjDraft(obj.title);
  };

  const cancelObjEdit = () => {
    editingObjRef.current = null;
    setEditingObjId(null);
    setObjDraft("");
  };

  // Salva somente se houve alteração real (Enter, blur ou botão de check).
  const commitObjEdit = (obj: Objective) => {
    if (editingObjRef.current !== obj.id) return;
    editingObjRef.current = null;
    setEditingObjId(null);
    setObjDraft("");
    const next = objDraft.trim();
    if (!next || next === obj.title) return;
    onUpdateObjective(obj.id, { title: next });
  };

  const submitObj = (topicId: string) => {
    if (!newObjTitle.trim()) return;
    onCreateObjective(topicId, newObjTitle.trim());
    setNewObjTitle("");
  };

  const statusLabel: Record<string, string> = { not_started: "Não iniciado", in_progress: "Em andamento", completed: "Concluído" };

  return (
    <section className="screen-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">BIBLIOTECA DE ESTUDOS</p>
          <h1>Temas</h1>
          <p>Gerencie os objetivos de cada tema. São exibidos no "Tema do dia" e no progresso do ciclo.</p>
        </div>
        <button className="extra-fab" onClick={() => setCreateTopicOpen(true)} title="Novo tema" aria-label="Novo tema">
          <Icon name="plus" size={19} />
        </button>
      </div>
      {data.topics.length === 0 ? (
        <div className="empty-hero">
          <div className="empty-hero-icon"><Icon name="book" size={28} /></div>
          <h1>Nenhum tema ainda</h1>
          <p>Temas são os assuntos que você estuda. Crie o primeiro para montar ciclos, rotina semanal e tarefas.</p>
          <button className="primary-button" onClick={() => setCreateTopicOpen(true)}><Icon name="plus" size={18} /> Criar primeiro tema</button>
        </div>
      ) : null}
      <div className="topic-grid">
        {data.topics.map((topic) => {
          const sessions = data.sessions.filter((session) => session.topicId === topic.id && session.status === "completed");
          const open = data.tasks.filter((task) => task.topicId === topic.id && task.status !== "completed").length;
          const topicObjs = data.objectives.filter((objective) => objective.topicId === topic.id);
          const avgProgress = topicObjs.length ? Math.round(topicObjs.reduce((sum, item) => sum + item.progress, 0) / topicObjs.length) : 0;
          const isExpanded = expandedTopic === topic.id;
          return (
            <article key={topic.id} className={`topic-card ${isExpanded ? "topic-expanded" : ""}`}>
              <div className={`topic-icon ${topic.color}`}><Icon name="book" size={22} /></div>
              <button
                className="topic-menu-btn"
                onClick={() => setMenuTopicId(menuTopicId === topic.id ? null : topic.id)}
                aria-label="Menu do tema"
                aria-expanded={menuTopicId === topic.id}
                title="Menu"
              >
                <Icon name="more-v" size={17} />
              </button>
              {menuTopicId === topic.id ? (
                <>
                  <div className="topic-menu-backdrop" onClick={() => setMenuTopicId(null)} />
                  <div className="topic-menu" role="menu" aria-label="Ações do tema">
                    <button
                      className="topic-menu-item"
                      role="menuitem"
                      onClick={() => { setMenuTopicId(null); setEditingTopic(topic); }}
                    >
                      <Icon name="edit" size={14} /> Editar tema
                    </button>
                    <button
                      className="topic-menu-item danger"
                      role="menuitem"
                      onClick={() => { setMenuTopicId(null); setDeletingTopic(topic); }}
                    >
                      <Icon name="trash" size={14} /> Excluir tema
                    </button>
                  </div>
                </>
              ) : null}
              <h2>{topic.name}</h2>
              <p>{topic.description}</p>
              <div className="topic-meta"><span>{sessions.length} sessões</span><span>{open} pendências</span><span>{topicObjs.length} objetivos</span></div>
              <div className="mini-objectives"><span>Progresso dos objetivos</span><b>{avgProgress}%</b></div>
              <div className="small-progress"><i style={{ width: `${avgProgress}%` }} /></div>
              <button className="topic-obj-toggle" onClick={() => { setExpandedTopic(isExpanded ? null : topic.id); setNewObjTitle(""); }}>
                <Icon name="target" size={14} /> {isExpanded ? "Fechar objetivos" : "Gerenciar objetivos"}
              </button>

              {isExpanded && (
                <div className="topic-obj-panel">
                  {topicObjs.length === 0 ? (
                    <p className="muted-note">Nenhum objetivo cadastrado neste tema.</p>
                  ) : (
                    <div className="obj-list">
                      {topicObjs.map((obj) => (
                        <div key={obj.id} className="obj-row">
                          <button
                            className={`obj-status-btn obj-${obj.status}`}
                            onClick={() => {
                              const next = Math.min(100, obj.progress + 10);
                              const st = next >= 100 ? "completed" : next > 0 ? "in_progress" : "not_started";
                              onUpdateObjective(obj.id, { progress: next, status: st });
                            }}
                            title={`Status: ${statusLabel[obj.status] ?? obj.status}. Clique para +10%.`}
                          >
                            {obj.status === "completed" ? <Icon name="check" size={12} stroke={3} /> : obj.status === "in_progress" ? <Icon name="bolt" size={12} /> : null}
                          </button>
                          <div className="obj-info">
                            {editingObjId === obj.id ? (
                              <span className="obj-edit-box">
                                <input
                                  ref={objInputRef}
                                  className="obj-edit-input"
                                  value={objDraft}
                                  maxLength={220}
                                  onChange={(event) => setObjDraft(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      commitObjEdit(obj);
                                    } else if (event.key === "Escape") {
                                      event.preventDefault();
                                      cancelObjEdit();
                                    }
                                  }}
                                  onBlur={() => commitObjEdit(obj)}
                                  aria-label="Renomear objetivo"
                                />
                                {objDraft.trim() !== obj.title && objDraft.trim() !== "" ? (
                                  <button
                                    type="button"
                                    className="obj-edit-save"
                                    title="Salvar alteração"
                                    aria-label="Salvar alteração"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => commitObjEdit(obj)}
                                  >
                                    <Icon name="check" size={13} stroke={3} />
                                  </button>
                                ) : null}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="obj-title-edit"
                                title="Clique para renomear o objetivo"
                                onClick={() => startObjEdit(obj)}
                              >
                                {obj.title}
                              </button>
                            )}
                            <ObjectiveProgressSlider
                              objective={obj}
                              onCommit={(progress, status) => onUpdateObjective(obj.id, { progress, status })}
                            />
                          </div>
                          <button className="delete-btn obj-del" onClick={() => setDeletingObj(obj)} aria-label="Excluir objetivo">
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <form className="obj-add" onSubmit={(e) => { e.preventDefault(); submitObj(topic.id); }}>
                    <input value={newObjTitle} onChange={(e) => setNewObjTitle(e.target.value)} placeholder="Novo objetivo…" />
                    <button className="primary-button" type="submit" disabled={!newObjTitle.trim()}>
                      <Icon name="plus" size={14} /> Adicionar
                    </button>
                  </form>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {deletingObj ? (
        <ConfirmModal
          title="Excluir objetivo"
          body={`O objetivo "${deletingObj.title}" será removido permanentemente.`}
          confirmLabel="Excluir objetivo"
          danger
          onClose={() => setDeletingObj(null)}
          onConfirm={() => {
            onDeleteObjective(deletingObj.id);
            setDeletingObj(null);
          }}
        />
      ) : null}
      {createTopicOpen ? (
        <TopicCreateModal
          defaultColor={TOPIC_COLORS[data.topics.length % TOPIC_COLORS.length]}
          onClose={() => setCreateTopicOpen(false)}
          onCreate={(payload) => { setCreateTopicOpen(false); onCreateTopic(payload); }}
        />
      ) : null}
      {deletingTopic ? (
        <ConfirmModal
          title="Excluir tema"
          body={`O tema "${deletingTopic.name}" será removido das listas e da rotina semanal, e suas sessões planejadas sairão do calendário. Os estudos já realizados permanecem no histórico.`}
          confirmLabel="Excluir tema"
          danger
          onClose={() => setDeletingTopic(null)}
          onConfirm={() => {
            onDeleteTopic(deletingTopic.id);
            setDeletingTopic(null);
            setExpandedTopic(null);
          }}
        />
      ) : null}
      {editingTopic ? (
        <TopicEditModal
          topic={editingTopic}
          onClose={() => setEditingTopic(null)}
          onSave={(payload) => {
            const topicId = editingTopic.id;
            setEditingTopic(null);
            onUpdateTopic(topicId, payload);
          }}
        />
      ) : null}
    </section>
  );
}

const TOPIC_COLORS = ["violet", "sky", "amber"];

function TopicCreateModal({
  defaultColor,
  onClose,
  onCreate,
}: {
  defaultColor: string;
  onClose: () => void;
  onCreate: (payload: { topicName: string; topicDescription: string; topicColor: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(defaultColor);

  const submit = () => {
    if (!name.trim()) return;
    onCreate({ topicName: name.trim(), topicDescription: description.trim(), topicColor: color });
  };

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Novo tema">
        <div className="modal-header">
          <div>
            <h2>Novo tema</h2>
            <p>Cadastre um assunto para usar nos ciclos, na rotina semanal e nas tarefas.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <label className="field span2">
              <span>Nome do tema *</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Redes de Distribuição Aérea" autoFocus />
            </label>
            <label className="field span2">
              <span>Descrição</span>
              <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="O que este tema aborda?" />
            </label>
            <div className="field span2">
              <span>Cor</span>
              <div className="color-options">
                {TOPIC_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`color-swatch ${option} ${color === option ? "on" : ""}`}
                    onClick={() => setColor(option)}
                    aria-label={`Cor ${option}`}
                    aria-pressed={color === option}
                  >
                    {color === option ? <Icon name="check" size={13} stroke={3} /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
          <button className="primary-button" onClick={submit} disabled={!name.trim()}>
            <Icon name="plus" size={16} /> Criar tema
          </button>
        </div>
      </div>
    </div>
  );
}

function TopicEditModal({
  topic,
  onClose,
  onSave,
}: {
  topic: TopicItem;
  onClose: () => void;
  onSave: (payload: { topicName: string; topicDescription: string }) => void;
}) {
  const [name, setName] = useState(topic.name);
  const [description, setDescription] = useState(topic.description ?? "");

  const submit = () => {
    if (!name.trim()) return;
    onSave({ topicName: name.trim(), topicDescription: description.trim() });
  };

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Editar tema">
        <div className="modal-header">
          <div>
            <h2>Editar tema</h2>
            <p>As alterações valem para o app inteiro: Tema do dia, ciclos, rotina, tarefas e histórico.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <label className="field span2">
              <span>Nome do tema *</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }}
                placeholder="Ex.: Redes de Distribuição Aérea"
                autoFocus
              />
            </label>
            <label className="field span2">
              <span>Descrição</span>
              <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="O que este tema aborda?" />
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
          <button className="primary-button" onClick={submit} disabled={!name.trim()}>
            <Icon name="save" size={15} /> Salvar alterações
          </button>
        </div>
      </div>
    </div>
  );
}

function TasksView({
  data,
  onToggle,
  onCreate,
  onRequestDelete,
  enteringTaskIds,
  leavingTaskIds,
}: {
  data: Dashboard;
  onToggle: (id: string) => void;
  onCreate: (payload: { title: string; topicId: string; cycleId: string | null; priority: Task["priority"] }) => void;
  onRequestDelete: (id: string) => void;
  enteringTaskIds: Set<string>;
  leavingTaskIds: Set<string>;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "completed">("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newTopicId, setNewTopicId] = useState(data.topics[0]?.id ?? "");
  const [newPriority, setNewPriority] = useState<Task["priority"]>("medium");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!newTopicId && data.topics[0]?.id) setNewTopicId(data.topics[0].id);
  }, [data.topics, newTopicId]);

  const counts = useMemo(() => {
    const open = data.tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").length;
    const completed = data.tasks.filter((task) => task.status === "completed").length;
    return { all: data.tasks.length, open, completed };
  }, [data.tasks]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.tasks
      .filter((task) => {
        if (statusFilter === "open") return task.status !== "completed" && task.status !== "cancelled";
        if (statusFilter === "completed") return task.status === "completed";
        return true;
      })
      .filter((task) => topicFilter === "all" || task.topicId === topicFilter)
      .filter((task) => {
        if (!normalized) return true;
        return `${task.title} ${task.topicName ?? ""}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => {
        const openA = a.status === "completed" ? 1 : 0;
        const openB = b.status === "completed" ? 1 : 0;
        if (openA !== openB) return openA - openB;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [data.tasks, statusFilter, topicFilter, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; color: string; tasks: Task[] }>();
    for (const topic of data.topics) map.set(topic.id, { key: topic.id, name: topic.name, color: topic.color, tasks: [] });
    for (const task of filtered) {
      const key = task.topicId ?? "unassigned";
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: task.topicId ? (task.topicName ?? "Tema removido") : "Sem tema",
          color: task.topicId ? (task.topicColor ?? "violet") : "slate",
          tasks: [],
        });
      }
      map.get(key)!.tasks.push(task);
    }
    return [...map.values()]
      .filter((group) => group.tasks.length > 0)
      .map((group) => ({
        ...group,
        open: group.tasks.filter((task) => task.status !== "completed").length,
        done: group.tasks.filter((task) => task.status === "completed").length,
      }));
  }, [filtered, data.topics]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim() || !newTopicId) return;
    onCreate({
      title: newTitle.trim(),
      topicId: newTopicId,
      cycleId: data.cycle?.id ?? null,
      priority: newPriority,
    });
    setNewTitle("");
  };

  return (
    <section className="screen-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">AÇÃO</p>
          <h1>Tarefas</h1>
          <p>Tarefas agrupadas por tema, com filtros, busca e histórico de abertura e conclusão.</p>
        </div>
        <span className="count-pill">{counts.open} abertas</span>
      </div>

      <div className="tasks-toolbar card">
        <div className="tasks-filter">
          <button className={statusFilter === "all" ? "filter-active" : ""} onClick={() => setStatusFilter("all")}>Todas · {counts.all}</button>
          <button className={statusFilter === "open" ? "filter-active" : ""} onClick={() => setStatusFilter("open")}>Em aberto · {counts.open}</button>
          <button className={statusFilter === "completed" ? "filter-active" : ""} onClick={() => setStatusFilter("completed")}>Concluídas · {counts.completed}</button>
        </div>
        <div className="tasks-tools">
          <div className="history-search task-search">
            <Icon name="spark" size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar tarefas ou temas" />
          </div>
          <select className="topic-select" value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)} aria-label="Filtrar por tema">
            <option value="all">Todos os temas</option>
            {data.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </select>
        </div>
      </div>

      <form className="task-create card" onSubmit={submit}>
        <div className="task-create-grid">
          <label className="field task-title-field">
            <span>Nova tarefa</span>
            <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Descreva a pendência" />
          </label>
          <div className="task-create-options">
            <label className="field">
              <span>Tema</span>
              <select value={newTopicId} onChange={(event) => setNewTopicId(event.target.value)} required>
                {data.topics.length === 0 ? <option value="">Cadastre um tema primeiro</option> : null}
                {data.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Prioridade</span>
              <select value={newPriority} onChange={(event) => setNewPriority(event.target.value as Task["priority"])}>
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
              </select>
            </label>
          </div>
          <button className="primary-button" type="submit" disabled={!newTitle.trim() || !newTopicId}>
            <Icon name="plus" size={16} /> Adicionar
          </button>
        </div>
      </form>

      {groups.length === 0 ? (
        <div className="tasks-full card">
          <div className="empty-inline tasks-empty-inline"><Icon name="check" size={16} /><span>Nenhuma tarefa encontrada com os filtros atuais.</span></div>
        </div>
      ) : (
        groups.map((group) => {
          const isCollapsed = !!collapsed[group.key];
          return (
            <section key={group.key} className={`task-group ${isCollapsed ? "collapsed" : ""}`}>
              <header className="task-group-header">
                <button
                  className="group-collapse"
                  onClick={() => setCollapsed((previous) => ({ ...previous, [group.key]: !isCollapsed }))}
                  aria-label={isCollapsed ? "Expandir tema" : "Recolher tema"}
                >
                  <Icon name="chevron" size={15} />
                </button>
                <span className={`group-dot ${group.color}`} />
                <h2>{group.name}</h2>
                <span className="task-group-counts">{group.open} em aberto · {group.done} concluídas</span>
              </header>
              {!isCollapsed ? (
                <div className="task-group-body">
                  {group.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => onToggle(task.id)}
                      onDelete={() => onRequestDelete(task.id)}
                      isEntering={enteringTaskIds.has(task.id)}
                      isLeaving={leavingTaskIds.has(task.id)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })
      )}

    </section>
  );
}

function HistoryView({
  data,
  onInspectSession,
}: {
  data: Dashboard;
  onInspectSession: (session: StudySession) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "planned" | "missed">("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");

  const counts = useMemo(() => {
    const all = data.sessions.length;
    const completed = data.sessions.filter((s) => s.status === "completed").length;
    const planned = data.sessions.filter((s) => s.status === "planned").length;
    const missed = data.sessions.filter((s) => s.status === "missed").length;
    return { all, completed, planned, missed };
  }, [data.sessions]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.sessions
      .filter((session) => {
        if (statusFilter === "completed") return session.status === "completed";
        if (statusFilter === "planned") return session.status === "planned";
        if (statusFilter === "missed") return session.status === "missed";
        return true;
      })
      .filter((session) => topicFilter === "all" || session.topicId === topicFilter)
      .filter((session) => {
        if (!normalized) return true;
        return `${session.topicName} ${session.notes ?? ""} ${session.learnings ?? ""} ${session.nextSteps ?? ""}`
          .toLowerCase()
          .includes(normalized);
      })
      .sort((a, b) => new Date(b.studyDate).getTime() - new Date(a.studyDate).getTime());
  }, [data.sessions, statusFilter, topicFilter, query]);

  return (
    <section className="screen-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">MEMÓRIA DE ESTUDO</p>
          <h1>Histórico</h1>
          <p>O planejamento permanece visível, e tudo o que foi realizado fica registrado.</p>
        </div>
      </div>

      <div className="tasks-toolbar card">
        <div className="tasks-filter">
          <button className={statusFilter === "all" ? "filter-active" : ""} onClick={() => setStatusFilter("all")}>Todos · {counts.all}</button>
          <button className={statusFilter === "completed" ? "filter-active" : ""} onClick={() => setStatusFilter("completed")}>Concluídos · {counts.completed}</button>
          <button className={statusFilter === "planned" ? "filter-active" : ""} onClick={() => setStatusFilter("planned")}>Planejados · {counts.planned}</button>
          <button className={statusFilter === "missed" ? "filter-active" : ""} onClick={() => setStatusFilter("missed")}>Não realizados · {counts.missed}</button>
        </div>
        <div className="tasks-tools">
          <div className="history-search task-search">
            <Icon name="spark" size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nos registros" />
          </div>
          <select className="topic-select" value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)} aria-label="Filtrar por tema">
            <option value="all">Todos os temas</option>
            {data.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </select>
        </div>
      </div>

      <div className="history-list">
        {filtered.length === 0 ? (
          <div className="empty-inline history-empty-inline"><Icon name="clock" size={16} /><span>Nenhum registro encontrado com os filtros atuais.</span></div>
        ) : (
          filtered.map((session) => (
            <article key={session.id} className="history-entry">
              <div className="history-date">
                <strong>{new Date(`${session.studyDate}T12:00:00`).getDate()}</strong>
                <span>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(`${session.studyDate}T12:00:00`)).replace(".", "")}</span>
              </div>
              <div className="history-line" />
              <div className="history-content">
                <div className="history-entry-top">
                  <span className={`status-chip ${statusClass(session.status)}`}><i /> {sessionLabel(session.status)}</span>
                  <div className="calendar-session-side">
                    <span>{session.durationMinutes ? timeLabel(session.durationMinutes) : ""}</span>
                    {session.status === "completed" ? (
                      <button
                        type="button"
                        className="calendar-clock-btn"
                        onClick={() => onInspectSession(session)}
                        title="Ver registro completo deste estudo"
                        aria-label="Ver registro completo deste estudo"
                      >
                        <Icon name="clock" size={13} />
                      </button>
                    ) : null}
                  </div>
                </div>
                <h2>{session.topicName}</h2>
                <p>{session.notes || "Sem registros detalhados nesta sessão."}</p>
                {session.nextSteps && (
                  <div className="history-next">
                    <Icon name="arrow" size={15} /> {session.nextSteps}
                  </div>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function DashboardView({ data }: { data: Dashboard }) {
  const [selected, setSelected] = useState<string>("overall");
  const living = data.cycles.filter((c) => c.status !== "cancelled");

  const scope = selected === "overall"
    ? { id: "overall", name: "Visão geral", sessions: data.sessions, objectives: data.objectives, tasks: data.tasks }
    : (() => {
        const cycleId = selected;
        const sessions = data.sessions.filter((s) => s.cycleId === cycleId);
        const objectives = data.objectives.filter((o) => o.cycleId === cycleId);
        const tasks = data.tasks.filter((t) => t.cycleId === cycleId);
        const cycle = data.cycles.find((c) => c.id === cycleId);
        return { id: cycleId, name: cycle?.name ?? "Ciclo", sessions, objectives, tasks };
      })();

  const completedSessions = scope.sessions.filter((s) => s.status === "completed");
  const totalMinutes = completedSessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
  const completedTasks = scope.tasks.filter((t) => t.status === "completed").length;
  const pendingTasks = scope.tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
  const objectivesDone = scope.objectives.filter((o) => o.status === "completed").length;

  const cycleProgress = selected !== "overall"
    ? (() => {
        const c = data.cycles.find((item) => item.id === selected);
        return c ? c.progress : 0;
      })()
    : Math.round((completedSessions.length / Math.max(1, scope.sessions.length)) * 100);

  const perCycleStats = data.cycles
    .filter((c) => c.status !== "cancelled")
    .map((c) => {
      const sess = data.sessions.filter((s) => s.cycleId === c.id && s.status === "completed");
      return { id: c.id, name: c.name, minutes: sess.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0), sessions: sess.length };
    });

  const topicStats = data.topics.map((topic) => ({
    ...topic,
    minutes: scope.sessions
      .filter((session) => session.topicId === topic.id && session.status === "completed")
      .reduce((total, session) => total + (session.durationMinutes ?? 0), 0),
  }));
  const maxMinutes = Math.max(...topicStats.map((topic) => topic.minutes), 1);
  const maxCycleMinutes = Math.max(...perCycleStats.map((s) => s.minutes), 1);

  return (
    <section className="screen-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">ACOMPANHAMENTO</p>
          <h1>{selected === "overall" ? "Dashboard geral" : "Dashboard do ciclo"}</h1>
          <p>{selected === "overall" ? "Uma leitura consolidada de todos os ciclos de estudo." : `Acompanhamento do ciclo ${scope.name}.`}</p>
        </div>
        <select className="cycle-select" value={selected} onChange={(event) => setSelected(event.target.value)} aria-label="Selecionar ciclo">
          <option value="overall">Visão geral</option>
          {living.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="metric-grid">
        <Metric label={selected === "overall" ? "Sessões concluídas" : "Progresso do ciclo"} value={selected === "overall" ? String(completedSessions.length) : `${cycleProgress}%`} sub={selected === "overall" ? `${scope.sessions.length} sessões no total` : scope.id !== "overall" ? `Dia ${data.cycles.find((c) => c.id === scope.id)?.elapsedDays ?? "–"} de ${data.cycles.find((c) => c.id === scope.id)?.durationDays ?? "–"}` : "Crie um ciclo"} icon="layers" tone="violet" />
        <Metric label="Tempo estudado" value={timeLabel(totalMinutes)} sub={`${completedSessions.length} sessões concluídas`} icon="clock" tone="sky" />
        <Metric label="Tarefas concluídas" value={String(completedTasks)} sub={`${pendingTasks} ainda abertas`} icon="check" tone="mint" />
        <Metric label="Objetivos" value={`${objectivesDone}/${scope.objectives.length}`} sub="finalizados" icon="target" tone="amber" />
      </div>

      <section className="dashboard-grid">
        <article className="card chart-card">
          <CardTitle kicker="DISTRIBUIÇÃO DE ESFORÇO" title="Tempo por tema" />
          <div className="bar-chart">
            {topicStats.map((topic) => (
              <div key={topic.id} className="bar-row">
                <div><span>{topic.name}</span><b>{timeLabel(topic.minutes)}</b></div>
                <i><em className={topic.color} style={{ width: `${(topic.minutes / maxMinutes) * 100}%` }} /></i>
              </div>
            ))}
          </div>
        </article>
        <article className="card objective-card">
          <CardTitle kicker="OBJETIVOS" title="Seu avanço" />
          {scope.objectives.length === 0 ? (
            <div className="empty-inline dashboard-empty-inline"><Icon name="target" size={16} /><span>Sem objetivos neste escopo.</span></div>
          ) : (
            scope.objectives.map((objective) => (
              <div key={objective.id} className="objective-row">
                <div><span>{objective.title}</span><b>{objective.progress}%</b></div>
                <i><em style={{ width: `${objective.progress}%` }} /></i>
              </div>
            ))
          )}
        </article>
      </section>

      {selected === "overall" && perCycleStats.length > 0 && (
        <section className="card chart-card" style={{ marginTop: 18 }}>
          <CardTitle kicker="POR CICLO" title="Tempo e sessões por ciclo" />
          <div className="bar-chart">
            {perCycleStats.map((c) => (
              <div key={c.id} className="bar-row">
                <div><span>{c.name}</span><b>{timeLabel(c.minutes)} · {c.sessions} {c.sessions === 1 ? "sessão" : "sessões"}</b></div>
                <i><em className="violet" style={{ width: `${(c.minutes / maxCycleMinutes) * 100}%` }} /></i>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

function Metric({ label, value, sub, icon, tone }: { label: string; value: string; sub: string; icon: string; tone: string }) { return <article className="metric-card"><span className={`metric-icon ${tone}`}><Icon name={icon} size={19} /></span><p>{label}</p><strong>{value}</strong><small>{sub}</small></article>; }


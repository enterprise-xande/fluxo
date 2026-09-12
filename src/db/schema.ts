import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const cycleStatus = pgEnum("cycle_status", [
  "planned",
  "active",
  "paused",
  "completed",
  "cancelled",
]);

export const sessionStatus = pgEnum("session_status", [
  "planned",
  "in_progress",
  "completed",
  "missed",
  "rescheduled",
]);

export const taskStatus = pgEnum("task_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const objectiveStatus = pgEnum("objective_status", [
  "not_started",
  "in_progress",
  "completed",
]);

export const priority = pgEnum("priority", ["low", "medium", "high"]);

export const appUsers = pgTable("app_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 200 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  role: varchar("role", { length: 30 }).default("user").notNull(),
  clockMode: varchar("clock_mode", { length: 20 }).default("auto").notNull(),
  clockAnchorReal: timestamp("clock_anchor_real", { withTimezone: true }),
  clockAnchorSim: timestamp("clock_anchor_sim", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const topics = pgTable("topics", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 20 }).default("indigo").notNull(),
  status: varchar("status", { length: 30 }).default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const studyCycles = pgTable("study_cycles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  startDate: date("start_date").notNull(),
  durationDays: integer("duration_days").notNull(),
  status: cycleStatus("status").default("planned").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const cycleTopics = pgTable("cycle_topics", {
  id: uuid("id").defaultRandom().primaryKey(),
  cycleId: uuid("cycle_id").notNull().references(() => studyCycles.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const topicSchedules = pgTable("topic_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  cycleId: uuid("cycle_id").notNull().references(() => studyCycles.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  position: integer("position").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const objectives = pgTable("objectives", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id").references(() => studyCycles.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").references(() => topics.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 220 }).notNull(),
  progress: integer("progress").default(0).notNull(),
  priority: priority("priority").default("medium").notNull(),
  status: objectiveStatus("status").default("not_started").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const studySessions = pgTable("study_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id").references(() => studyCycles.id, { onDelete: "set null" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "restrict" }),
  plannedDate: date("planned_date"),
  studyDate: date("study_date").notNull(),
  startTime: varchar("start_time", { length: 5 }),
  endTime: varchar("end_time", { length: 5 }),
  durationMinutes: integer("duration_minutes"),
  status: sessionStatus("status").default("planned").notNull(),
  isExtra: boolean("is_extra").default(false).notNull(),
  wasReplanned: boolean("was_replanned").default(false).notNull(),
  notes: text("notes"),
  learnings: text("learnings"),
  difficulties: text("difficulties"),
  questions: text("questions"),
  nextSteps: text("next_steps"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id").references(() => studyCycles.id, { onDelete: "set null" }),
  topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
  objectiveId: uuid("objective_id").references(() => objectives.id, { onDelete: "set null" }),
  sessionId: uuid("session_id").references(() => studySessions.id, { onDelete: "set null" }),
  title: varchar("title", { length: 240 }).notNull(),
  priority: priority("priority").default("medium").notNull(),
  status: taskStatus("status").default("pending").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

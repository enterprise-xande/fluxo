import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { appUsers, authSessions, objectives, studyCycles, topics } from "@/db/schema";

// Requires the managed preview to be running. No existing account is changed.
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const fixtureUserId = randomUUID();
const token = randomBytes(32).toString("base64url");

type ObjectiveResult = { id: string; progress: number; status: string; createdAt: string; topicId: string | null };
type Workspace = { user: { id: string }; cycle: { id: string } | null; objectives: ObjectiveResult[] };

async function request(body?: Record<string, unknown>): Promise<Workspace> {
  const response = await fetch(`${base}/api/study`, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, sessionToken: token }),
  } : {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  assert.equal(response.status, 200, `Unexpected study API status: ${response.status}`);
  const workspace = await response.json() as Workspace;
  assert.equal(workspace.user.id, fixtureUserId);
  return workspace;
}

async function run() {
  await db.insert(appUsers).values({
    id: fixtureUserId,
    name: "Objective ordering regression",
    email: `objective-order-${fixtureUserId}@example.invalid`,
    role: "user",
  });
  await db.insert(authSessions).values({
    userId: fixtureUserId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  const [topic] = await db.insert(topics).values({ userId: fixtureUserId, name: "Ordering regression topic" }).returning();
  const ids: string[] = Array.from({ length: 5 }, () => randomUUID()).sort();
  const sharedCreatedAt = new Date("2020-01-01T12:00:00.000Z");
  const laterCreatedAt = new Date("2020-01-02T12:00:00.000Z");
  // Equal-priority, equal-timestamp objectives are deliberately inserted out of
  // their final order to exercise the unique-id tie-breaker.
  await db.insert(objectives).values([
    { id: ids[2], userId: fixtureUserId, topicId: topic.id, title: "Medium C", priority: "medium", createdAt: sharedCreatedAt },
    { id: ids[1], userId: fixtureUserId, topicId: topic.id, title: "Medium B", priority: "medium", createdAt: sharedCreatedAt },
    { id: ids[0], userId: fixtureUserId, topicId: topic.id, title: "Medium A", priority: "medium", createdAt: sharedCreatedAt },
    { id: ids[3], userId: fixtureUserId, topicId: topic.id, title: "High priority", priority: "high", createdAt: laterCreatedAt },
    { id: ids[4], userId: fixtureUserId, topicId: topic.id, title: "Low priority", priority: "low", createdAt: sharedCreatedAt },
  ]);
  const expectedOrder = [ids[3], ids[0], ids[1], ids[2], ids[4]];
  const orderedIds = (workspace: Workspace) => workspace.objectives.map(item => item.id);

  for (const withCycle of [false, true]) {
    if (withCycle) {
      const [cycle] = await db.insert(studyCycles).values({
        userId: fixtureUserId, name: "Ordering regression cycle", startDate: "2026-01-01", durationDays: 90, status: "active",
      }).returning();
      await db.update(objectives).set({ cycleId: cycle.id }).where(eq(objectives.userId, fixtureUserId));
    }
    const initial = await request();
    assert.equal(Boolean(initial.cycle), withCycle);
    assert.deepEqual(orderedIds(initial), expectedOrder);
    const createdTimes = initial.objectives.map(item => item.createdAt);

    for (const objectiveId of [ids[1], ids[0], ids[2]]) {
      for (const progress of [10, 47, 100, 0, 60]) {
        const status = progress === 100 ? "completed" : progress > 0 ? "in_progress" : "not_started";
        const updated = await request({ action: "update-objective", values: { objectiveId, progress, status } });
        assert.deepEqual(orderedIds(updated), expectedOrder, "Updating progress reordered objectives");
        assert.deepEqual(updated.objectives.map(item => item.createdAt), createdTimes, "Creation dates changed");
        const objective = updated.objectives.find(item => item.id === objectiveId);
        assert.equal(objective?.progress, progress);
        assert.equal(objective?.status, status);
        assert.deepEqual(orderedIds(await request()), expectedOrder, "Reload changed objective order");
      }
    }
    const created = await request({ action: "create-objective", topicId: topic.id, title: "New objective" });
    const added = created.objectives.find(item => !expectedOrder.includes(item.id));
    assert.ok(added);
    assert.deepEqual(created.objectives.filter(item => item.id !== added.id).map(item => item.id), expectedOrder);
    await request({ action: "delete-objective", values: { objectiveId: added.id } });
    assert.deepEqual(orderedIds(await request()), expectedOrder);
    console.log(`PASS: stable order after progress, completion, reopening, creation, deletion and reload (${withCycle ? "with cycle" : "without cycle"}).`);
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : "Objective ordering regression failed");
  process.exitCode = 1;
}).finally(async () => {
  await db.delete(appUsers).where(and(
    eq(appUsers.id, fixtureUserId), eq(appUsers.email, `objective-order-${fixtureUserId}@example.invalid`),
  ));
  await pool.end();
  console.log("Temporary regression data removed; existing accounts and objectives were preserved.");
});

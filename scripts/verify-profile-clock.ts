import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium, expect, type Browser } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import { appUsers, authSessions } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";

// Run against the managed preview; only uniquely identified test accounts are changed.
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const baseline = process.argv.includes("--baseline");
const ids: string[] = [];
let browser: Browser | undefined;

async function run() {
  browser = await chromium.launch({ headless: true });
  const password = `Test-${randomBytes(20).toString("hex")}`;
  const passwordHash = await hashPassword(password);
  const [admin, regular] = await db.insert(appUsers).values([
    { name: "Clock Regression Admin", email: `clock-admin-${randomBytes(8).toString("hex")}@example.invalid`, role: "admin", passwordHash },
    { name: "Clock Regression User", email: `clock-user-${randomBytes(8).toString("hex")}@example.invalid`, role: "user", passwordHash },
  ]).returning({ id: appUsers.id, email: appUsers.email });
  ids.push(admin.id, regular.id);

  for (const stripTransport of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, timezoneId: "UTC" });
    // Emulate a restrictive preview proxy only for the clock request. No production
    // fetch implementation is replaced; the scenario exists in this test alone.
    if (stripTransport) {
      await context.addInitScript(() => {
        const original = window.fetch.bind(window);
        window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          let clockMutation = url.includes("/api/admin/clock");
          if (typeof init?.body === "string") {
            try { clockMutation ||= JSON.parse(init.body).action === "update-system-time"; } catch { /* not JSON */ }
          }
          if (!clockMutation) return original(input, init);
          const cleanHeaders = new Headers(init?.headers);
          cleanHeaders.delete("authorization");
          return original(input, { ...init, headers: Object.fromEntries(cleanHeaders.entries()), credentials: "omit" });
        };
      });
    }
    const page = await context.newPage();
    const browserErrors: string[] = [];
    page.on("pageerror", error => browserErrors.push(error.message));
    await page.goto(base);
    await page.getByPlaceholder("voce@exemplo.com").fill(admin.email);
    await page.getByPlaceholder("Sua senha", { exact: true }).fill(password);
    const loginResponse = page.waitForResponse(response => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
    await page.locator(".auth-submit").click();
    const login = await (await loginResponse).json();
    assert.equal(typeof login.token, "string");
    const token: string = login.token;
    await expect(page.locator(".app-shell")).toBeVisible();
    const beforeSessions = await db.select({ id: authSessions.id, expiresAt: authSessions.expiresAt }).from(authSessions).where(eq(authSessions.userId, admin.id));
    assert.ok(beforeSessions.length > 0);

    await page.locator(".top-avatar").click();
    const modal = page.getByRole("dialog", { name: "Perfil do usuário" });
    await modal.getByRole("button", { name: "Simular horário", exact: true }).click();
    await modal.getByLabel("Definir data do sistema", { exact: true }).fill("2045-05-17");
    await modal.getByLabel("Definir hora do sistema", { exact: true }).fill("14:35");
    const clockRequest = () => page.waitForResponse(response => response.request().method() === "POST" && (
      response.url().endsWith("/api/admin/clock") || (response.url().endsWith("/api/study") && Boolean(response.request().postData()?.includes("update-system-time")))
    ));
    const applying = clockRequest();
    await modal.locator(".profile-sim-btn.apply").click();
    const result = await applying;

    if (baseline && stripTransport) {
      assert.equal(result.status(), 401);
      await expect(page.locator(".auth-shell")).toBeVisible();
      console.log("REPRODUCED: clock request without header/cookie returns 401 and closes the workspace.");
      await context.close();
      continue;
    }

    assert.equal(result.status(), 200, `Clock mutation failed (${stripTransport ? "restricted" : "normal"} transport)`);
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Horário do sistema atualizado.", { exact: true })).toBeVisible();
    await expect(page.locator(".auth-shell")).toHaveCount(0);
    const storedToken = await page.evaluate(() => window.localStorage.getItem("fluxo.session.token"));
    assert.equal(storedToken, token);
    const firstResponse = await fetch(`${base}/api/study`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.user.id, admin.id);
    assert.equal(first.today, "2045-05-17");
    assert.equal(first.user.clockMode, "simulated");
    await new Promise(resolve => setTimeout(resolve, 1200));
    const second = await (await fetch(`${base}/api/study`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.ok(Date.parse(second.user.clockNow) > Date.parse(first.user.clockNow));
    const afterSessions = await db.select({ id: authSessions.id, expiresAt: authSessions.expiresAt }).from(authSessions).where(eq(authSessions.userId, admin.id));
    assert.deepEqual(afterSessions, beforeSessions, "Simulated time changed auth sessions or expiry");

    const syncing = clockRequest();
    await modal.locator(".profile-sim-btn.sync").click();
    assert.equal((await syncing).status(), 200);
    await expect(modal).toBeVisible();
    const restored = await (await fetch(`${base}/api/study`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(restored.user.clockMode, "auto");
    assert.ok(Math.abs(Date.parse(restored.user.clockNow) - Date.now()) < 10000);

    if (!baseline) {
      // Unauthorized, invalid and server-error requests must not close the account
      // or silently discard the date/time draft; the server must still reject them.
      for (const status of [401, 403, 500]) {
        await page.route("**/api/admin/clock", route => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ message: `Erro de teste ${status}` }) }));
        await modal.getByLabel("Definir data do sistema", { exact: true }).fill("2040-06-15");
        await modal.getByLabel("Definir hora do sistema", { exact: true }).fill("09:20");
        await modal.locator(".profile-sim-btn.apply").click();
        await expect(modal.getByRole("alert")).toContainText(`Erro de teste ${status}`);
        await expect(modal).toBeVisible();
        await expect(modal.getByLabel("Definir data do sistema", { exact: true })).toHaveValue("2040-06-15");
        await expect(page.locator(".auth-shell")).toHaveCount(0);
        assert.equal(await page.evaluate(() => localStorage.getItem("fluxo.session.token")), token);
        await page.unroute("**/api/admin/clock");
      }
    }
    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible();
    assert.deepEqual(browserErrors, [], "Client-side exception during profile clock flow");
    console.log(`PASS: login, set future date, clock ticking, sync and reload (${stripTransport ? "no headers/cookies on clock" : "normal"}). Auth expiry unchanged.`);
    await context.close();
  }

  if (!baseline) {
    const login = async (email: string) => {
      const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const userAuth = await login(regular.email);
    const adminAuth = await login(admin.email);
    const send = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/admin/clock`, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    assert.equal((await send({ studyDate: "2045-05-17", startTime: "14:35" })).status, 401);
    assert.equal((await send({ studyDate: "2045-05-17", startTime: "14:35", sessionToken: "not-a-valid-token" })).status, 401);
    assert.equal((await send({ studyDate: "2045-05-17", startTime: "14:35", sessionToken: userAuth.token })).status, 403);
    // An explicit invalid token may not silently fall back to an admin cookie/header.
    assert.equal((await send({ studyDate: "2045-05-17", startTime: "14:35", sessionToken: "invalid" }, { Authorization: `Bearer ${adminAuth.token}` })).status, 401);
    for (const invalid of [
      { studyDate: "2045-02-30", startTime: "14:35" },
      { studyDate: "2045-05-17", startTime: "25:01" },
      { studyDate: "2045-05-17", startTime: "" },
    ]) {
      assert.equal((await send({ ...invalid, sessionToken: adminAuth.token })).status, 400);
    }
    const legacy = await fetch(`${base}/api/study`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update-system-time", studyDate: "1995-03-12", startTime: "10:05", sessionToken: adminAuth.token }),
    });
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json()).today, "1995-03-12");
    assert.equal((await send({ studyDate: "", startTime: "", sessionToken: adminAuth.token })).status, 200);
    // Expired/revoked sessions remain rejected; a login is never recreated by clock changes.
    await db.update(authSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authSessions.userId, admin.id));
    assert.equal((await send({ studyDate: "2045-05-17", startTime: "14:35", sessionToken: adminAuth.token })).status, 401);
    const [unchanged] = await db.select({ clockMode: appUsers.clockMode }).from(appUsers).where(eq(appUsers.id, admin.id));
    assert.equal(unchanged.clockMode, "auto");
    console.log("PASS: 401 for missing/invalid/expired token; 403 for regular user; 400 for invalid dates; legacy action also validated.");
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : "Clock regression failed");
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  if (ids.length) await db.delete(appUsers).where(inArray(appUsers.id, ids));
  await pool.end();
  console.log("Temporary regression accounts removed; existing accounts and sessions were not modified.");
});

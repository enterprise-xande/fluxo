import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { applySessionCookie, createSession, isSecureRequest, normalizeEmail, verifyPassword } from "@/lib/auth";
import { isAdminEmail } from "@/lib/clock";
import { DEMO_ACCOUNT, ensureDemoAccount, getStudyDashboard } from "@/lib/study-data";

export const dynamic = "force-dynamic";

const INVALID = { message: "E-mail ou senha inválidos." };

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const nativeForm = !contentType.includes("application/json");
    let body: { email?: string; password?: string };
    if (nativeForm) {
      const form = await request.formData();
      body = { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
    } else {
      body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
    }
    const email = normalizeEmail(String(body.email ?? ""));
    const password = String(body.password ?? "");

    if (!email || !password) return NextResponse.json(INVALID, { status: 401 });

    // A conta de demonstração é provisionada sob demanda (útil em bancos novos
    // e para migrar a conta antiga que ainda não tinha senha).
    if (email === DEMO_ACCOUNT.email) await ensureDemoAccount();

    const [user] = await db.select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !valid) return NextResponse.json(INVALID, { status: 401 });

    // E-mails listados em FLUXO_ADMIN_EMAILS são promovidos ao entrar.
    if (user.role !== "admin" && isAdminEmail(user.email)) {
      await db.update(appUsers).set({ role: "admin", updatedAt: new Date() }).where(eq(appUsers.id, user.id));
      user.role = "admin";
    }

    const { token, expiresAt } = await createSession(user.id);
    // Login e carregamento do ambiente são uma única operação: o cliente não
    // precisa fazer uma segunda requisição antes de abrir a plataforma.
    const workspace = await getStudyDashboard(user.id);
    const response = nativeForm
      ? new NextResponse(null, { status: 303, headers: { Location: `/#session=${encodeURIComponent(token)}` } })
      : NextResponse.json({
          user: { id: user.id, name: user.name, email: user.email },
          token,
          expiresAt: expiresAt.toISOString(),
          workspace,
        });
    applySessionCookie(response, token, expiresAt, isSecureRequest(request));
    return response;
  } catch (error) {
    console.error("Failed to log in", error);
    return NextResponse.json({ message: "Não foi possível entrar agora." }, { status: 500 });
  }
}

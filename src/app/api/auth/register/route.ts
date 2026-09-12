import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { applySessionCookie, createSession, hashPassword, isSecureRequest, isValidEmail, normalizeEmail } from "@/lib/auth";
import { countUsers, isAdminEmail } from "@/lib/clock";
import { getStudyDashboard } from "@/lib/study-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const nativeForm = !contentType.includes("application/json");
    let body: { name?: string; email?: string; password?: string };
    if (nativeForm) {
      const form = await request.formData();
      body = {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      };
    } else {
      body = (await request.json().catch(() => ({}))) as { name?: string; email?: string; password?: string };
    }
    const name = String(body.name ?? "").trim();
    const email = normalizeEmail(String(body.email ?? ""));
    const password = String(body.password ?? "");

    if (name.length < 2) return NextResponse.json({ message: "Informe seu nome." }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ message: "O nome é muito longo." }, { status: 400 });
    if (!isValidEmail(email) || email.length > 200) {
      return NextResponse.json({ message: "Informe um e-mail válido." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ message: "A senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
    }
    if (password.length > 128) {
      return NextResponse.json({ message: "A senha é muito longa." }, { status: 400 });
    }

    const [existing] = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.email, email)).limit(1);
    if (existing) {
      return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });
    }

    // Bootstrap: a primeira conta de um banco novo vira administradora.
    // Além disso, e-mails listados em FLUXO_ADMIN_EMAILS são promovidos.
    const firstAccount = (await countUsers()) === 0;
    const role = firstAccount || isAdminEmail(email) ? "admin" : "user";

    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(appUsers).values({ name, email, passwordHash, role }).returning();
    const { token, expiresAt } = await createSession(user.id);
    const workspace = await getStudyDashboard(user.id);

    const response = nativeForm
      ? new NextResponse(null, { status: 303, headers: { Location: `/#session=${encodeURIComponent(token)}` } })
      : NextResponse.json(
          {
            user: { id: user.id, name: user.name, email: user.email },
            token,
            expiresAt: expiresAt.toISOString(),
            workspace,
          },
          { status: 201 },
        );
    applySessionCookie(response, token, expiresAt, isSecureRequest(request));
    return response;
  } catch (error) {
    console.error("Failed to register user", error);
    return NextResponse.json({ message: "Não foi possível criar a conta." }, { status: 500 });
  }
}

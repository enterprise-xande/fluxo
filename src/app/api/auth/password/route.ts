import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { getSessionUser, getSessionUserFromToken, hashPassword, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      currentPassword?: string;
      newPassword?: string;
      sessionToken?: string;
    };

    // O token no corpo é um canal adicional para previews/iframes em que o
    // proxy ou navegador pode descartar cookie/cabeçalho Authorization.
    // Ele passa pela mesma validação criptográfica e de expiração da sessão.
    const explicitToken = String(body.sessionToken ?? "").trim();
    const sessionUser = explicitToken
      ? await getSessionUserFromToken(explicitToken)
      : await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ message: "Faça login para continuar." }, { status: 401 });
    }

    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");

    if (!currentPassword) {
      return NextResponse.json({ message: "Informe a senha atual." }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ message: "A nova senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
    }
    if (newPassword.length > 128) {
      return NextResponse.json({ message: "A nova senha é muito longa." }, { status: 400 });
    }

    const [user] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, sessionUser.id))
      .limit(1);

    if (!user) {
      return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ message: "A senha atual está incorreta." }, { status: 403 });
    }

    const newHash = await hashPassword(newPassword);
    await db
      .update(appUsers)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(appUsers.id, user.id));

    return NextResponse.json({ ok: true, message: "Senha alterada com sucesso." });
  } catch (error) {
    console.error("Failed to change password", error);
    return NextResponse.json({ message: "Não foi possível alterar a senha." }, { status: 500 });
  }
}

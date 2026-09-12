import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    return NextResponse.json({ user });
  } catch (error) {
    console.error("Failed to resolve session", error);
    return NextResponse.json({ message: "Não foi possível verificar a sessão." }, { status: 500 });
  }
}

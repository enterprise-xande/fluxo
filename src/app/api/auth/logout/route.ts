import { NextResponse } from "next/server";
import { clearSessionCookie, destroySessionByToken, getSessionTokens, isSecureRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const tokens = await getSessionTokens();
    await Promise.all(tokens.map((token) => destroySessionByToken(token)));
  } catch (error) {
    console.error("Failed to destroy session", error);
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response, isSecureRequest(request));
  return response;
}

import { getRequestSessionUser } from "@/lib/auth";
import { ClockUpdateError, updateUserClock } from "@/lib/clock";
import { getStudyDashboard } from "@/lib/study-data";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json({ message: "Dados de horário inválidos." }, { status: 400, headers });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return Response.json({ message: "Envie a data e a hora em formato JSON." }, { status: 400, headers });
    }

    const user = await getRequestSessionUser(request, body.sessionToken);
    if (!user) {
      return Response.json(
        { code: "UNAUTHENTICATED", message: "Não foi possível validar sua sessão. Entre novamente para alterar o horário; os campos foram mantidos." },
        { status: 401, headers },
      );
    }

    // A função verifica a categoria atual no banco e só modifica o relógio
    // deste usuário. Tokens, cookies e datas de expiração não são alterados.
    await updateUserClock(user.id, body.studyDate, body.startTime);
    return Response.json(await getStudyDashboard(user.id), { headers });
  } catch (error) {
    if (error instanceof ClockUpdateError) {
      return Response.json({ message: error.message }, { status: error.status, headers });
    }
    console.error("Failed to update profile clock", error);
    return Response.json(
      { message: "Não foi possível salvar o horário agora. Tente novamente." },
      { status: 500, headers },
    );
  }
}

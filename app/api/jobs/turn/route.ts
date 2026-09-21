import { NextResponse } from "next/server";
import { z } from "zod";
import { logError } from "@/lib/observability/logger";
import { verifyQueueRequest } from "@/lib/queue/turn";
import { runTurn } from "@/lib/turn/run";

/**
 * Worker do turno, chamado pela fila (QStash) depois do debounce.
 * Só entra requisição com assinatura válida.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const jobSchema = z.object({ conversationId: z.string().uuid() });

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();

  if (!(await verifyQueueRequest(request, body))) {
    return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 401 });
  }

  const parsed = jobSchema.safeParse(JSON.parse(body || "{}"));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_job" }, { status: 400 });
  }

  try {
    const outcome = await runTurn({ conversationId: parsed.data.conversationId });
    // `failed` já tratou o usuário (fallback + fila morta): 200 evita que a
    // fila reentregue e gere segunda mensagem.
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    logError("jobs.turn.unhandled", error, {
      conversationId: parsed.data.conversationId,
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

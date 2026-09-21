import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestInboundMessage } from "@/lib/conversations/repository";
import { serverEnv } from "@/lib/env";
import { describeError, logError, logInfo } from "@/lib/observability/logger";
import { enqueueTurn } from "@/lib/queue/turn";
import { getGateway } from "@/lib/whatsapp/gateway";
import { RATE_LIMITED } from "@/lib/turn/messages";

/**
 * Webhook de entrada do WhatsApp.
 *
 * Trata o payload como hostil: valida segredo e instância, descarta fromMe,
 * grupo, broadcast e JID malformado, grava de forma idempotente e devolve 200
 * rápido. O trabalho pesado vai para a fila. Ver CLAUDE.md §5.
 *
 * Responde 200 também no descarte: o provider não deve reentregar o que
 * decidimos ignorar.
 */

export const runtime = "nodejs";

const jsonBody = z.unknown();

export async function POST(request: Request): Promise<Response> {
  const gateway = getGateway();
  const url = new URL(request.url);

  if (!gateway.verifyInbound({ headers: request.headers, url })) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const raw = await request.text();
  let payload: unknown;
  try {
    payload = jsonBody.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }

  const parsed = gateway.parseInbound(payload);
  if (!parsed.ok) {
    logInfo("whatsapp.inbound.discarded", { reason: parsed.reason });
    return NextResponse.json({ ok: true, ignored: parsed.reason });
  }

  try {
    const result = await ingestInboundMessage(parsed.message);

    if (!result.stored) {
      // Reentrega do mesmo provider_message_id.
      logInfo("whatsapp.inbound.duplicate", {
        providerMessageId: parsed.message.providerMessageId,
      });
      return NextResponse.json({ ok: true, ignored: "duplicate" });
    }

    if (result.optedOut) {
      return NextResponse.json({ ok: true, ignored: "opted_out" });
    }

    const limit = serverEnv().RATE_LIMIT_MESSAGES_PER_DAY;
    if (result.messagesToday > limit) {
      // Avisa uma única vez ao cruzar o limite; depois fica em silêncio.
      if (result.messagesToday === limit + 1) {
        await gateway
          .sendText({ waJid: parsed.message.waJid, text: RATE_LIMITED })
          .catch((error: unknown) => {
            logError("whatsapp.rate_limit_notice_failed", error);
          });
      }
      logInfo("whatsapp.inbound.rate_limited", { contactId: result.contactId });
      return NextResponse.json({ ok: true, ignored: "rate_limited" });
    }

    const queued = await enqueueTurn({ conversationId: result.conversationId });
    return NextResponse.json({ ok: true, mode: queued.mode });
  } catch (error) {
    logError("whatsapp.inbound.failed", error, {
      providerMessageId: parsed.message.providerMessageId,
    });
    // 500 faz o provider reentregar; a idempotência garante que não duplica.
    return NextResponse.json(
      { ok: false, reason: describeError(error) },
      { status: 500 },
    );
  }
}

import { answerQuestion } from "@/lib/ai/agent";
import { OPT_OUT_CONFIRMATION, isOptOutRequest } from "@/lib/ai/guardrails";
import {
  claimPendingMessages,
  conversationSnapshot,
  markOptOut,
  recentHistory,
  recordAiRun,
  recordJobFailure,
  recordOutboundMessage,
} from "@/lib/conversations/repository";
import { describeError, logInfo, logError } from "@/lib/observability/logger";
import { getGateway } from "@/lib/whatsapp/gateway";
import { splitForWhatsApp } from "@/lib/whatsapp/split";
import { ASK_FOR_TEXT_AUDIO, ASK_FOR_TEXT_OTHER, FALLBACK_ERROR } from "./messages";

/**
 * Executa um turno: agrega as mensagens pendentes da conversa em UMA pergunta,
 * responde e envia. Três mensagens em sequência viram um turno, não três
 * respostas sobrepostas. Ver CLAUDE.md §7 e docs/auditoria-n8n.md (B8).
 */

export type TurnOutcome =
  | { status: "answered"; blocks: number }
  | { status: "asked_for_text" }
  | { status: "opted_out" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export async function runTurn(input: { conversationId: string }): Promise<TurnOutcome> {
  const { conversationId } = input;
  const snapshot = await conversationSnapshot(conversationId);

  if (!snapshot) return { status: "skipped", reason: "conversation_not_found" };

  // Handoff ativo: o bot fica em silêncio, mas consome o pendente para não
  // responder tudo de uma vez quando a conversa voltar.
  if (snapshot.status === "handoff") {
    await claimPendingMessages(conversationId);
    return { status: "skipped", reason: "handoff_active" };
  }

  if (snapshot.optedOut) {
    await claimPendingMessages(conversationId);
    return { status: "skipped", reason: "opted_out" };
  }

  const pending = await claimPendingMessages(conversationId);
  if (pending.length === 0) return { status: "skipped", reason: "no_pending_messages" };

  const gateway = getGateway();
  const withText = pending.filter((message) => message.body.trim().length > 0);
  const question = withText.map((message) => message.body.trim()).join("\n");

  // Opt-out tem prioridade sobre tudo. CLAUDE.md §13.
  if (question && isOptOutRequest(question)) {
    await markOptOut(snapshot.contactId);
    await deliver({
      conversationId,
      contactId: snapshot.contactId,
      waJid: snapshot.waJid,
      text: OPT_OUT_CONFIRMATION,
    });
    logInfo("turn.opted_out", { conversationId });
    return { status: "opted_out" };
  }

  // Nenhum texto aproveitável: pede texto sem gastar chamada de modelo.
  if (!question) {
    const onlyAudio = pending.every((message) => message.kind === "audio");
    await deliver({
      conversationId,
      contactId: snapshot.contactId,
      waJid: snapshot.waJid,
      text: onlyAudio ? ASK_FOR_TEXT_AUDIO : ASK_FOR_TEXT_OTHER,
    });
    return { status: "asked_for_text" };
  }

  await gateway.setTyping({ waJid: snapshot.waJid });

  const history = await recentHistory(conversationId, {
    limit: 20,
    excludeIds: pending.map((message) => message.id),
  });

  try {
    const answer = await answerQuestion({
      conversationId,
      question,
      history,
      state: {
        isFirstInteraction: snapshot.isFirstInteraction,
        canOfferSimulator:
          snapshot.simulatorOfferedAt === null && snapshot.simulatorDeclinedAt === null,
        simulatorAlreadyAccepted: snapshot.simulatorAcceptedAt !== null,
      },
    });

    const { firstMessageId, blocks } = await deliver({
      conversationId,
      contactId: snapshot.contactId,
      waJid: snapshot.waJid,
      text: answer.text,
    });

    await recordAiRun({
      conversationId,
      messageId: firstMessageId,
      model: answer.model,
      promptVersion: answer.promptVersion,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
      latencyMs: answer.latencyMs,
      retrievedCount: answer.retrievedCount,
      citedChunkIds: answer.citedChunkIds,
      refused: answer.refused,
      refusalReason: answer.refusalReason,
    });

    logInfo("turn.answered", {
      conversationId,
      blocks,
      refused: answer.refused,
      refusalReason: answer.refusalReason,
      retrieved: answer.retrievedCount,
      latencyMs: answer.latencyMs,
    });

    return { status: "answered", blocks };
  } catch (error) {
    // Silêncio nunca é resultado aceitável. CLAUDE.md §8.
    const description = describeError(error);
    logError("turn.failed", error, { conversationId });

    await recordJobFailure({
      kind: "turn",
      payload: { conversationId, messageIds: pending.map((message) => message.id) },
      error: description,
    });

    await deliver({
      conversationId,
      contactId: snapshot.contactId,
      waJid: snapshot.waJid,
      text: FALLBACK_ERROR,
    }).catch((sendError: unknown) => {
      logError("turn.fallback_send_failed", sendError, { conversationId });
    });

    return { status: "failed", error: description };
  }
}

/** Envia a resposta em blocos e registra cada um como mensagem de saída. */
async function deliver(input: {
  conversationId: string;
  contactId: string;
  waJid: string;
  text: string;
}): Promise<{ firstMessageId: string | null; blocks: number }> {
  const gateway = getGateway();
  const blocks = splitForWhatsApp(input.text);
  let firstMessageId: string | null = null;

  for (const [index, block] of blocks.entries()) {
    // Pequena pausa entre blocos para a leitura não virar uma parede de texto.
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1_200));

    let providerMessageId: string | null = null;
    let failed = false;
    try {
      const sent = await gateway.sendText({ waJid: input.waJid, text: block });
      providerMessageId = sent.providerMessageId;
    } catch (error) {
      failed = true;
      logError("turn.send_failed", error, {
        conversationId: input.conversationId,
        index,
      });
    }

    const messageId = await recordOutboundMessage({
      conversationId: input.conversationId,
      contactId: input.contactId,
      body: block,
      providerMessageId,
      provider: gateway.provider,
      failed,
    });

    firstMessageId ??= messageId;
    if (failed) throw new Error("falha ao enviar mensagem pelo gateway");
  }

  return { firstMessageId, blocks: blocks.length };
}

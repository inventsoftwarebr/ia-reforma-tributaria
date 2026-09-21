/**
 * Normalização do webhook da Evolution API.
 *
 * O fluxo n8n original lia apenas `message.conversation`: áudio, imagem,
 * mensagem citada, mensagem com link, botão e lista chegavam vazios ao agente,
 * que respondia sobre nada. Aqui todo tipo conhecido é tratado, e o que não tem
 * texto aproveitável é marcado com `hasText: false` para receber o pedido de
 * texto sem passar pelo modelo. Ver CLAUDE.md §6 e docs/auditoria-n8n.md (B1).
 */

import type { InboundMedia, MessageKind, ParseResult } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const DIRECT_JID = /^(\d{10,15})@s\.whatsapp\.net$/;

/** Só conversa 1:1. Grupo (@g.us), status e lista de transmissão ficam fora. */
export function parseDirectJid(jid: string): { waJid: string; phoneE164: string } | null {
  const match = DIRECT_JID.exec(jid);
  if (!match?.[1]) return null;
  return { waJid: jid, phoneE164: `+${match[1]}` };
}

/**
 * Desembrulha os envelopes que o WhatsApp usa para mensagem temporária,
 * visualização única e documento com legenda.
 */
function unwrapMessage(message: Record<string, unknown>): Record<string, unknown> {
  const wrappers = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "editedMessage",
  ];

  let current = message;
  for (let depth = 0; depth < 4; depth += 1) {
    const wrapper = wrappers.find((name) => asRecord(current[name]));
    if (!wrapper) break;
    const inner = asRecord(asRecord(current[wrapper])?.message);
    if (!inner) break;
    current = inner;
  }
  return current;
}

interface Extracted {
  kind: MessageKind;
  text: string;
  media: InboundMedia | null;
}

function mediaFrom(node: Record<string, unknown> | null): InboundMedia | null {
  if (!node) return null;
  const media: InboundMedia = {};
  const mimetype = asString(node.mimetype);
  const fileName = asString(node.fileName);
  const url = asString(node.url);
  const seconds = asNumber(node.seconds);
  if (mimetype) media.mimetype = mimetype;
  if (fileName) media.fileName = fileName;
  if (url) media.url = url;
  if (seconds !== undefined) media.seconds = seconds;
  return Object.keys(media).length > 0 ? media : null;
}

/** Extrai texto e tipo. Retorna null quando a mensagem não merece resposta. */
function extract(message: Record<string, unknown>): Extracted | null {
  const conversation = asString(message.conversation);
  if (conversation.trim()) return { kind: "text", text: conversation, media: null };

  const extended = asRecord(message.extendedTextMessage);
  if (extended) {
    return { kind: "quoted_text", text: asString(extended.text), media: null };
  }

  const buttons = asRecord(message.buttonsResponseMessage);
  if (buttons) {
    return { kind: "button", text: asString(buttons.selectedDisplayText), media: null };
  }

  const templateButton = asRecord(message.templateButtonReplyMessage);
  if (templateButton) {
    return {
      kind: "button",
      text: asString(templateButton.selectedDisplayText),
      media: null,
    };
  }

  const list = asRecord(message.listResponseMessage);
  if (list) {
    const title = asString(list.title);
    const single = asRecord(list.singleSelectReply);
    return {
      kind: "list",
      text: title || asString(single?.selectedRowId),
      media: null,
    };
  }

  const image = asRecord(message.imageMessage);
  if (image) {
    return { kind: "image", text: asString(image.caption), media: mediaFrom(image) };
  }

  const video = asRecord(message.videoMessage);
  if (video) {
    return { kind: "video", text: asString(video.caption), media: mediaFrom(video) };
  }

  const audio = asRecord(message.audioMessage);
  // Transcrição é fase 5; até lá o áudio recebe o pedido de texto.
  if (audio) return { kind: "audio", text: "", media: mediaFrom(audio) };

  const document = asRecord(message.documentMessage);
  if (document) {
    return {
      kind: "document",
      text: asString(document.caption),
      media: mediaFrom(document),
    };
  }

  if (asRecord(message.stickerMessage)) {
    return { kind: "sticker", text: "", media: null };
  }

  const location = asRecord(message.locationMessage);
  if (location) return { kind: "location", text: "", media: null };

  // Reação e evento de protocolo (revogação, entrega) não geram resposta.
  if (asRecord(message.reactionMessage) || asRecord(message.protocolMessage)) return null;

  if (conversation) return { kind: "text", text: conversation, media: null };

  return { kind: "unsupported", text: "", media: null };
}

export interface ParseOptions {
  /** Allowlist de instâncias. Vazio rejeita tudo — nunca deixar sem valor. */
  allowedInstances: readonly string[];
}

/**
 * Converte o corpo do webhook da Evolution em `InboundMessage`.
 *
 * Nunca confia no payload: valida instância, descarta `fromMe`, grupo,
 * broadcast e JID malformado antes de qualquer trabalho. Ver CLAUDE.md §5.
 */
export function parseEvolutionWebhook(
  payload: unknown,
  options: ParseOptions,
): ParseResult {
  const body = asRecord(payload);
  if (!body) return { ok: false, reason: "not_a_message_event" };

  const instance = asString(body.instance);
  if (!instance || !options.allowedInstances.includes(instance)) {
    return { ok: false, reason: "instance_not_allowed" };
  }

  const data = asRecord(body.data);
  const key = asRecord(data?.key);
  if (!data || !key) return { ok: false, reason: "not_a_message_event" };

  if (key.fromMe === true) return { ok: false, reason: "from_me" };

  const jid = asString(key.remoteJid);
  if (!jid) return { ok: false, reason: "invalid_jid" };

  const direct = parseDirectJid(jid);
  if (!direct) {
    // Grupo e broadcast são JIDs válidos, só não são atendidos aqui.
    const isKnownNonDirect =
      /@(g\.us|broadcast|newsletter)$/.test(jid) || jid === "status@broadcast";
    return { ok: false, reason: isKnownNonDirect ? "not_direct_chat" : "invalid_jid" };
  }

  const providerMessageId = asString(key.id);
  if (!providerMessageId) return { ok: false, reason: "missing_message_id" };

  const rawMessage = asRecord(data.message);
  if (!rawMessage) return { ok: false, reason: "not_a_message_event" };

  const extracted = extract(unwrapMessage(rawMessage));
  if (!extracted) return { ok: false, reason: "reaction_or_protocol" };

  const text = extracted.text.trim();
  const timestampSeconds = asNumber(data.messageTimestamp);
  const pushName = asString(data.pushName).trim();

  return {
    ok: true,
    message: {
      provider: "evolution",
      providerMessageId,
      instance,
      waJid: direct.waJid,
      phoneE164: direct.phoneE164,
      pushName: pushName || null,
      kind: extracted.kind,
      text,
      hasText: text.length > 0,
      media: extracted.media,
      sentAt: timestampSeconds ? new Date(timestampSeconds * 1000) : new Date(),
      raw: payload,
    },
  };
}

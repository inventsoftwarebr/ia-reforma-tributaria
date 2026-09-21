import type { messageKindEnum } from "@/db/schema";

export type MessageKind = (typeof messageKindEnum.enumValues)[number];

export type WhatsAppProvider = "evolution" | "cloud_api";

export interface InboundMedia {
  mimetype?: string;
  fileName?: string;
  seconds?: number;
  url?: string;
}

/**
 * Mensagem de entrada já normalizada. `text` é o único campo que o agente
 * consome; `hasText: false` significa que a conversa recebe o pedido de texto
 * em vez de chamar o modelo. Ver CLAUDE.md §6.
 */
export interface InboundMessage {
  provider: WhatsAppProvider;
  providerMessageId: string;
  instance: string;
  waJid: string;
  phoneE164: string;
  pushName: string | null;
  kind: MessageKind;
  text: string;
  hasText: boolean;
  media: InboundMedia | null;
  sentAt: Date;
  raw: unknown;
}

/**
 * Motivos de descarte. Todos respondem 200 no webhook — o provider não deve
 * ficar reentregando o que decidimos ignorar.
 */
export type DiscardReason =
  | "not_a_message_event"
  | "from_me"
  | "not_direct_chat"
  | "invalid_jid"
  | "instance_not_allowed"
  | "reaction_or_protocol"
  | "missing_message_id";

export type ParseResult =
  { ok: true; message: InboundMessage } | { ok: false; reason: DiscardReason };

export interface SendTextResult {
  providerMessageId: string | null;
}

export interface WhatsAppGateway {
  readonly provider: WhatsAppProvider;
  /** Valida o segredo do webhook (header x-invent-token ou ?token=). */
  verifyInbound(input: { headers: Headers; url: URL }): boolean;
  parseInbound(payload: unknown): ParseResult;
  sendText(input: { waJid: string; text: string }): Promise<SendTextResult>;
  setTyping(input: { waJid: string; durationMs?: number }): Promise<void>;
}

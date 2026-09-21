import type { WhatsAppGateway } from "./types";

/**
 * WhatsApp Cloud API (Meta) — porta reservada para a migração do gateway
 * (decisão D2). Implementar aqui mantém rota, worker e agente intactos.
 *
 * Pendências quando for implementar: verificação de assinatura
 * `X-Hub-Signature-256` com WHATSAPP_APP_SECRET, normalização do envelope
 * `entry[].changes[].value.messages[]` e janela de 24h para mensagem livre.
 */

function notImplemented(): never {
  throw new Error(
    "WHATSAPP_GATEWAY=cloud_api ainda não está implementado. Use evolution ou implemente lib/whatsapp/cloud-api.ts.",
  );
}

export const cloudApiGateway: WhatsAppGateway = {
  provider: "cloud_api",
  verifyInbound: notImplemented,
  parseInbound: notImplemented,
  sendText: notImplemented,
  setTyping: notImplemented,
};

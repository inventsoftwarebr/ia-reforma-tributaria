import { describe, expect, it } from "vitest";
import { parseDirectJid, parseEvolutionWebhook } from "./normalize";

/**
 * Casos portados de legacy/tools/test-hotfix.mjs: cada um corresponde a um tipo
 * de mensagem que o fluxo n8n original entregava vazio ao agente (achado B1) ou
 * a um filtro de segurança do webhook (achados S1/S2/B6).
 */

const ALLOWED = { allowedInstances: ["invent"] as const };
const JID = "5562999998888@s.whatsapp.net";

function webhook(
  message: Record<string, unknown>,
  overrides: {
    key?: Record<string, unknown>;
    instance?: string;
    pushName?: string;
    messageTimestamp?: number;
  } = {},
) {
  return {
    event: "messages.upsert",
    instance: overrides.instance ?? "invent",
    data: {
      key: { remoteJid: JID, id: "ABC123", fromMe: false, ...overrides.key },
      pushName: overrides.pushName ?? "Maria",
      messageTimestamp: overrides.messageTimestamp,
      message,
    },
  };
}

function parseOk(message: Record<string, unknown>, overrides = {}) {
  const result = parseEvolutionWebhook(webhook(message, overrides), ALLOWED);
  if (!result.ok) throw new Error(`esperava ok, veio ${result.reason}`);
  return result.message;
}

function parseFail(payload: unknown) {
  const result = parseEvolutionWebhook(payload, ALLOWED);
  if (result.ok) throw new Error("esperava descarte, veio ok");
  return result.reason;
}

describe("tipos de mensagem", () => {
  it("texto simples", () => {
    const message = parseOk({ conversation: "O que é CBS?" });
    expect(message.text).toBe("O que é CBS?");
    expect(message.kind).toBe("text");
    expect(message.hasText).toBe(true);
  });

  it("texto citado ou com link", () => {
    const message = parseOk({ extendedTextMessage: { text: "e o IBS?" } });
    expect(message.text).toBe("e o IBS?");
    expect(message.kind).toBe("quoted_text");
  });

  it("resposta de botão", () => {
    expect(parseOk({ buttonsResponseMessage: { selectedDisplayText: "Sim" } }).text).toBe(
      "Sim",
    );
  });

  it("resposta de template", () => {
    expect(
      parseOk({ templateButtonReplyMessage: { selectedDisplayText: "Quero" } }).text,
    ).toBe("Quero");
  });

  it("resposta de lista pelo título", () => {
    expect(parseOk({ listResponseMessage: { title: "Créditos" } }).text).toBe("Créditos");
  });

  it("resposta de lista sem título cai no rowId", () => {
    expect(
      parseOk({ listResponseMessage: { singleSelectReply: { selectedRowId: "opt-2" } } })
        .text,
    ).toBe("opt-2");
  });

  it("imagem com legenda usa a legenda", () => {
    const message = parseOk({
      imageMessage: { caption: "isso muda?", mimetype: "image/jpeg" },
    });
    expect(message.text).toBe("isso muda?");
    expect(message.kind).toBe("image");
    expect(message.media).toEqual({ mimetype: "image/jpeg" });
  });

  it("vídeo com legenda usa a legenda", () => {
    expect(parseOk({ videoMessage: { caption: "vale para serviço?" } }).text).toBe(
      "vale para serviço?",
    );
  });

  it("áudio não tem texto e não vai ao modelo", () => {
    const message = parseOk({ audioMessage: { seconds: 12, mimetype: "audio/ogg" } });
    expect(message.kind).toBe("audio");
    expect(message.hasText).toBe(false);
    expect(message.media).toEqual({ mimetype: "audio/ogg", seconds: 12 });
  });

  it("documento sem legenda não tem texto", () => {
    const message = parseOk({ documentMessage: { fileName: "nf.pdf" } });
    expect(message.kind).toBe("document");
    expect(message.hasText).toBe(false);
  });

  it("documento com legenda aproveita a legenda", () => {
    expect(
      parseOk({ documentMessage: { fileName: "nf.pdf", caption: "confere?" } }).text,
    ).toBe("confere?");
  });

  it("sticker e localização não têm texto", () => {
    expect(parseOk({ stickerMessage: {} }).hasText).toBe(false);
    expect(parseOk({ locationMessage: { degreesLatitude: -16.6 } }).kind).toBe(
      "location",
    );
  });

  it("imagem sem legenda não tem texto", () => {
    expect(parseOk({ imageMessage: {} }).hasText).toBe(false);
  });

  it("texto só com espaço não tem texto", () => {
    expect(parseOk({ conversation: "   " }).hasText).toBe(false);
  });

  it("tipo desconhecido vira unsupported", () => {
    expect(parseOk({ pollCreationMessageV3: {} }).kind).toBe("unsupported");
  });

  it("reação e protocolo são descartados", () => {
    expect(parseFail(webhook({ reactionMessage: { text: "👍" } }))).toBe(
      "reaction_or_protocol",
    );
    expect(parseFail(webhook({ protocolMessage: { type: "REVOKE" } }))).toBe(
      "reaction_or_protocol",
    );
  });

  it("envelope efêmero é desembrulhado", () => {
    expect(
      parseOk({ ephemeralMessage: { message: { conversation: "pergunta efêmera" } } })
        .text,
    ).toBe("pergunta efêmera");
  });

  it("visualização única é desembrulhada", () => {
    expect(
      parseOk({ viewOnceMessageV2: { message: { imageMessage: { caption: "olha" } } } })
        .text,
    ).toBe("olha");
  });

  it("documento com legenda em envelope é desembrulhado", () => {
    expect(
      parseOk({
        documentWithCaptionMessage: {
          message: { documentMessage: { fileName: "x.pdf", caption: "analisa" } },
        },
      }).text,
    ).toBe("analisa");
  });
});

describe("filtros de segurança", () => {
  it("fromMe é descartado", () => {
    expect(parseFail(webhook({ conversation: "oi" }, { key: { fromMe: true } }))).toBe(
      "from_me",
    );
  });

  it("grupo é descartado", () => {
    expect(
      parseFail(webhook({ conversation: "oi" }, { key: { remoteJid: "12036304@g.us" } })),
    ).toBe("not_direct_chat");
  });

  it("status@broadcast é descartado", () => {
    expect(
      parseFail(
        webhook({ conversation: "oi" }, { key: { remoteJid: "status@broadcast" } }),
      ),
    ).toBe("not_direct_chat");
  });

  it("newsletter é descartada", () => {
    expect(
      parseFail(
        webhook({ conversation: "oi" }, { key: { remoteJid: "123@newsletter" } }),
      ),
    ).toBe("not_direct_chat");
  });

  it("jid malformado é descartado", () => {
    expect(
      parseFail(
        webhook({ conversation: "oi" }, { key: { remoteJid: "abc@s.whatsapp.net" } }),
      ),
    ).toBe("invalid_jid");
  });

  it("instância fora da allowlist é descartada", () => {
    expect(parseFail(webhook({ conversation: "oi" }, { instance: "outra" }))).toBe(
      "instance_not_allowed",
    );
  });

  it("instância vazia é descartada", () => {
    expect(parseFail(webhook({ conversation: "oi" }, { instance: "" }))).toBe(
      "instance_not_allowed",
    );
  });

  it("allowlist vazia rejeita tudo", () => {
    const result = parseEvolutionWebhook(webhook({ conversation: "oi" }), {
      allowedInstances: [],
    });
    expect(result.ok).toBe(false);
  });

  it("mensagem sem id é descartada", () => {
    expect(parseFail(webhook({ conversation: "oi" }, { key: { id: "" } }))).toBe(
      "missing_message_id",
    );
  });

  it("payload vazio, nulo ou sem data não explode", () => {
    expect(parseFail({})).toBe("instance_not_allowed");
    expect(parseFail(null)).toBe("not_a_message_event");
    expect(parseFail("texto")).toBe("not_a_message_event");
    expect(parseFail({ instance: "invent" })).toBe("not_a_message_event");
    expect(
      parseFail({ instance: "invent", data: { key: { remoteJid: JID, id: "1" } } }),
    ).toBe("not_a_message_event");
  });
});

describe("dados derivados", () => {
  it("extrai telefone E.164 e nome", () => {
    const message = parseOk({ conversation: "oi" });
    expect(message.phoneE164).toBe("+5562999998888");
    expect(message.waJid).toBe(JID);
    expect(message.pushName).toBe("Maria");
    expect(message.provider).toBe("evolution");
    expect(message.providerMessageId).toBe("ABC123");
  });

  it("nome em branco vira null", () => {
    expect(parseOk({ conversation: "oi" }, { pushName: "  " }).pushName).toBeNull();
  });

  it("usa o timestamp do provider quando existe", () => {
    const message = parseOk({ conversation: "oi" }, { messageTimestamp: 1_700_000_000 });
    expect(message.sentAt.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });

  it("parseDirectJid aceita só conversa 1:1", () => {
    expect(parseDirectJid(JID)).toEqual({ waJid: JID, phoneE164: "+5562999998888" });
    expect(parseDirectJid("12036304@g.us")).toBeNull();
    expect(parseDirectJid("")).toBeNull();
  });
});

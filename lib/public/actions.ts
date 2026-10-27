"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db/client";
import { webLeads } from "@/db/schema";
import { logError, logInfo } from "@/lib/observability/logger";
import { simulateInputSchema, simulateTurn } from "@/lib/simulator/run";
import type { SimulatedState } from "@/lib/simulator/state";
import { CONSENT_TEXT, leadSchema, normalizePhone } from "./lead";
import { consumeQuota } from "./quota";

/**
 * Ações do chat público do site. Sem login: tudo é validado aqui, com limite
 * de uso, e nada da conversa é gravado — só o pedido de contato, com
 * consentimento.
 */

const publicInputSchema = simulateInputSchema.extend({
  question: z.string().trim().min(1).max(1_000),
  history: simulateInputSchema.shape.history.max(12),
});

export interface PublicAnswer {
  blocks: string[];
  state: SimulatedState;
  /** A pessoa pediu especialista nesta resposta: abrir o formulário. */
  askContact: boolean;
  limited: boolean;
}

const LIMIT_VISITOR =
  "Você já fez bastante perguntas hoje. Amanhã eu volto a responder por aqui — e, se quiser, deixe seu contato que um especialista da *Invent* fala com você.";
const LIMIT_TOTAL =
  "Muita gente está usando a IA agora e atingimos o limite de hoje. Volte amanhã — ou deixe seu contato que um especialista da *Invent* fala com você.";

export async function askPublic(payload: unknown): Promise<PublicAnswer> {
  const parsed = publicInputSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      blocks: ["Não entendi a mensagem. Pode escrever de novo, em até 1.000 caracteres?"],
      state: (payload as { state?: SimulatedState })?.state ?? {
        isFirstInteraction: true,
        canOfferSimulator: true,
        simulatorAlreadyAccepted: false,
        handoff: false,
      },
      askContact: false,
      limited: false,
    };
  }
  const input = parsed.data;

  const quota = await consumeQuota(await headers(), "pergunta").catch(
    (error: unknown) => {
      // Banco fora do ar não pode liberar uso sem teto: trata como limite.
      logError("site.quota_failed", error);
      return { ok: false as const, reason: "total" as const };
    },
  );
  if (!quota.ok) {
    return {
      blocks: [quota.reason === "visitante" ? LIMIT_VISITOR : LIMIT_TOTAL],
      state: input.state,
      askContact: true,
      limited: true,
    };
  }

  const result = await simulateTurn(input, "site", "site");
  return {
    blocks: result.blocks,
    state: result.state,
    askContact: !input.state.handoff && result.state.handoff,
    limited: false,
  };
}

export type LeadResult = { ok: true } | { ok: false; error: string };

export async function submitLead(formData: FormData): Promise<LeadResult> {
  const raw = Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string"),
  );
  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Robô preencheu a armadilha: responde como se tivesse dado certo.
    if (issue?.path[0] === "website") return { ok: true };
    return { ok: false, error: issue?.message ?? "confira os campos" };
  }

  try {
    const quota = await consumeQuota(await headers(), "contato");
    if (!quota.ok) {
      return {
        ok: false,
        error: "recebemos vários pedidos deste acesso hoje; tente amanhã",
      };
    }

    const lead = parsed.data;
    await db.insert(webLeads).values({
      name: lead.name,
      email: lead.email,
      phone: normalizePhone(lead.phone),
      company: lead.company ?? null,
      message: lead.message ?? null,
      consentText: CONSENT_TEXT,
    });
    logInfo("site.lead_created", { company: lead.company ?? null });
    return { ok: true };
  } catch (error) {
    logError("site.lead_failed", error);
    return {
      ok: false,
      error: "não foi possível enviar agora; tente de novo em instantes",
    };
  }
}

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { serverEnv } from "@/lib/env";

/** Provedor trocável por variável de ambiente; o resto do código não sabe qual é. */
export function resolveModel(): LanguageModel {
  const { AI_PROVIDER, AI_MODEL } = serverEnv();
  return AI_PROVIDER === "anthropic" ? anthropic(AI_MODEL) : google(AI_MODEL);
}

export function modelLabel(): string {
  const { AI_PROVIDER, AI_MODEL } = serverEnv();
  return `${AI_PROVIDER}:${AI_MODEL}`;
}

/** Subconjunto das opções que o @ai-sdk/google aceita no modelo de linguagem. */
export type ModelProviderOptions = {
  google?: { thinkingConfig: { thinkingLevel: "minimal" | "low" | "medium" | "high" } };
};

/**
 * Opções específicas do provedor para a chamada de conversa.
 *
 * Gemini 3.x raciocina antes de responder, e esse raciocínio consome o mesmo
 * teto de tokens da resposta. Nível "low" basta para uma resposta curta, presa
 * aos trechos da base e com chamada de ferramenta — e evita que o raciocínio
 * coma o orçamento e a resposta saia cortada ou vazia.
 */
export function modelProviderOptions(provider: "google" | "anthropic"): ModelProviderOptions {
  if (provider === "google") {
    return { google: { thinkingConfig: { thinkingLevel: "low" } } };
  }
  return {};
}

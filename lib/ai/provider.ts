import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { serverEnv } from "@/lib/env";

/** Provider trocável (decisão D3): o resto do código não sabe qual é o modelo. */
export function resolveModel(): LanguageModel {
  const { AI_PROVIDER, AI_MODEL } = serverEnv();
  return AI_PROVIDER === "google" ? google(AI_MODEL) : anthropic(AI_MODEL);
}

export function modelLabel(): string {
  const { AI_PROVIDER, AI_MODEL } = serverEnv();
  return `${AI_PROVIDER}:${AI_MODEL}`;
}

import { serverEnv } from "@/lib/env";
import { cloudApiGateway } from "./cloud-api";
import { evolutionGateway } from "./evolution";
import type { WhatsAppGateway } from "./types";

/** Porta única de acesso ao WhatsApp. CLAUDE.md §14. */
export function getGateway(): WhatsAppGateway {
  return serverEnv().WHATSAPP_GATEWAY === "cloud_api"
    ? cloudApiGateway
    : evolutionGateway;
}

export type { WhatsAppGateway };

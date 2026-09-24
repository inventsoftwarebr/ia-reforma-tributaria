import { serverEnv } from "@/lib/env";

/**
 * Cliente HubSpot mínimo: só o que o lead do WhatsApp precisa.
 *
 * Telefone é a chave de deduplicação — a mesma pessoa volta a escrever semanas
 * depois e não pode virar um segundo contato.
 */

const BASE = "https://api.hubapi.com";

async function request(path: string, init: RequestInit): Promise<unknown> {
  const token = serverEnv().HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN não está setado.");

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`HubSpot ${response.status} em ${path}: ${detail.slice(0, 300)}`);
  }

  return response.json().catch(() => null);
}

function idOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

export interface ContactInput {
  phoneE164: string;
  firstName?: string;
  company?: string;
  /** Propriedades extras combinadas com o time de marketing. */
  extra?: Record<string, string>;
}

/** Procura pelo telefone e cria ou atualiza. Devolve o id do contato. */
export async function upsertContact(input: ContactInput): Promise<string> {
  const search = (await request("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [{ propertyName: "phone", operator: "EQ", value: input.phoneE164 }],
        },
      ],
      properties: ["phone"],
      limit: 1,
    }),
  })) as { results?: unknown[] } | null;

  const properties: Record<string, string> = {
    phone: input.phoneE164,
    ...(input.firstName ? { firstname: input.firstName } : {}),
    ...(input.company ? { company: input.company } : {}),
    ...input.extra,
  };

  const existingId = idOf(search?.results?.[0]);

  if (existingId) {
    await request(`/crm/v3/objects/contacts/${existingId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return existingId;
  }

  const created = await request("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });

  const id = idOf(created);
  if (!id) throw new Error("HubSpot não devolveu o id do contato criado.");
  return id;
}

export interface DealInput {
  name: string;
  contactId: string;
  description?: string;
}

/** Cria o negócio associado ao contato. Requer pipeline e etapa configurados. */
export async function createDeal(input: DealInput): Promise<string | null> {
  const env = serverEnv();
  if (!env.HUBSPOT_PIPELINE_ID || !env.HUBSPOT_DEAL_STAGE_ID) return null;

  const created = await request("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        dealname: input.name,
        pipeline: env.HUBSPOT_PIPELINE_ID,
        dealstage: env.HUBSPOT_DEAL_STAGE_ID,
        ...(input.description ? { description: input.description } : {}),
      },
      associations: [
        {
          to: { id: input.contactId },
          // 3 = deal → contact no schema padrão de associações do HubSpot.
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
        },
      ],
    }),
  });

  return idOf(created);
}

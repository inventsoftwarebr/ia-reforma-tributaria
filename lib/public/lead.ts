import { z } from "zod";

/** Texto do consentimento: o que a pessoa aceitou fica gravado com o lead. */
export const CONSENT_TEXT =
  "Autorizo a Invent Software a usar estes dados para entrar em contato comigo sobre a Reforma Tributária e suas soluções, conforme a LGPD. Posso pedir a exclusão dos meus dados a qualquer momento.";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const leadSchema = z.object({
  name: z.string().trim().min(2, "informe seu nome").max(120),
  email: z.string().trim().toLowerCase().email("e-mail inválido").max(200),
  phone: optional(40).refine(
    (value) => !value || /^\d{10,15}$/.test(value.replace(/\D/g, "")),
    "telefone com DDD, só números",
  ),
  company: optional(120),
  message: optional(1000),
  consent: z.literal("on", { message: "é preciso aceitar o contato" }),
  /** Armadilha para robô: campo invisível que pessoa nenhuma preenche. */
  website: z.string().max(0, "ignorado").optional(),
});

export type LeadInput = z.infer<typeof leadSchema>;

/** Telefone guardado só com dígitos, para a busca e o HubSpot. */
export function normalizePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

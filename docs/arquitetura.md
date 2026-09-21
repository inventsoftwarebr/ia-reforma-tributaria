# IA da Reforma Tributária — arquitetura alvo

Produto: agente de WhatsApp da **Invent Software** que responde dúvidas sobre a Reforma
Tributária (EC 132/2023, LC 214/2025 e normas subsequentes) e converte interesse em lead
qualificado / uso do Simulador da Reforma Tributária.

Este documento é o contrato de implementação. Regras do `CLAUDE.md` da Invent valem integralmente
aqui (conexão 6543, RLS default-deny, webhooks idempotentes, timezone, LGPD, guard-rails de IA).

## 1. Princípios de desenho

1. **Nunca inventar matéria tributária.** Resposta sem respaldo na base curada é recusa explícita
   com oferta de contato humano — não é palpite. Inverte o comportamento atual (achado Q1).
2. **Toda afirmação normativa tem citação** com fonte, dispositivo e link, além de vigência.
3. **Cálculo é código, não LLM.** Alíquotas e cronograma ficam em tabela versionada revisada pelo
   time fiscal da Invent; o modelo nunca produz número sozinho.
4. **Estado em Postgres, não no prompt.** Oferta do simulador, handoff, opt-out e rate limit são
   colunas, não instruções ao modelo (achado Q5).
5. **Gateway de WhatsApp é porta trocável.** Evolution API hoje; API oficial da Meta sem reescrever
   o domínio.
6. **Idempotente por construção.** Reentrega de webhook nunca gera segunda resposta (CLAUDE.md §6).
7. **Observável desde o dia 1.** Custo, latência, refusal e tema por conversa.

## 2. Stack

Mesma base da Invent, para reaproveitar convenção, design system e time:

- **Next.js 15 App Router** + TypeScript strict + Tailwind + shadcn/ui (console admin e futura
  widget web do agente).
- **Supabase Postgres** via Drizzle (`postgres-js`, `max: 1`, `prepare: false`, pooler **6543**),
  **pgvector** para RAG, RLS default-deny.
- **Vercel AI SDK** (`ai`) com provider abstraído — LLM principal a decidir (ver `../README.md`,
  decisão D3), embeddings idem.
- **Evolution API** na VPS/EasyPanel como gateway WhatsApp (mantido).
- **QStash** (ou `pgmq` + `pg_cron` no Supabase) para debounce/fila/retry assinado.
- **Sentry** para erro e **HubSpot** para lead, via padrão outbox (`lib/hubspot/`).
- Runtime **Node** em tudo que toca Postgres ou o SDK (CLAUDE.md §3).

## 3. Fluxo alvo

```
Evolution API ──POST──> /api/whatsapp/inbound            (Node, <300ms, responde 200 sempre)
                          1. valida HMAC/token + instância (allowlist)
                          2. descarta fromMe, @g.us, @broadcast, status@broadcast
                          3. normaliza QUALQUER tipo: conversation, extendedTextMessage,
                             audioMessage, imageMessage, documentMessage, buttons/list, reaction
                          4. INSERT messages ... ON CONFLICT (provider, provider_message_id)
                             DO NOTHING            ← idempotência
                          5. enfileira job com delay de debounce (~7s)

QStash ──POST assinado──> /api/jobs/turn                  (Node, maxDuration 60s)
                          1. lock otimista na conversa (SELECT ... FOR UPDATE SKIP LOCKED)
                          2. agrega mensagens não processadas do contato em UM turno
                          3. checa opt-out, rate limit e handoff ativo → pode encerrar aqui
                          4. presence "composing" no Evolution
                          5. transcreve áudio (fase 4) / recusa mídia não suportada
                          6. RAG: reescrita da pergunta com histórico → busca híbrida
                             (pgvector cosine + tsvector pt-BR) → top-k → contexto com metadados
                          7. geração com tools: buscar_base, cronograma_reforma,
                             oferecer_simulador, solicitar_contato_humano
                          8. grava ai_runs (modelo, tokens, custo, latência, chunks, refusal)
                          9. envia via gateway (split <1000 chars, delay entre blocos, retry)
                         10. extrai sinais → outbox HubSpot
```

Falha em qualquer etapa: retry do QStash (3x, backoff) → em falha final, mensagem de fallback ao
usuário ("não consegui processar agora, já avisei nosso time"), registro em `job_failures` e alerta
Sentry. Silêncio nunca é resultado aceitável (achado B10).

## 4. Esquema de dados (Drizzle)

Tabelas novas, todas com RLS habilitado e política explícita em `db/rls.sql` no mesmo commit
(CLAUDE.md §4). Leitura só para `is_admin()`/`is_agent()`; o worker usa service role server-only.

| Tabela | Papel | Colunas-chave |
|--------|-------|---------------|
| `contacts` | pessoa do outro lado | `phone_e164` unique, `wa_jid`, `push_name`, `consent` jsonb, `opt_out_at`, `hubspot_contact_id`, `first_seen_at`, `last_seen_at` |
| `conversations` | thread | `contact_id`, `channel`, `status` (`active`/`idle`/`handoff`/`closed`), `assigned_to`, `last_message_at` |
| `messages` | histórico auditável | `conversation_id`, `direction`, `provider`, `provider_message_id`, `kind`, `body`, `media` jsonb, `raw` jsonb, `status`, **unique(provider, provider_message_id)** |
| `conversation_state` | estado de negócio (1:1) | `simulator_offered_at`, `simulator_offer_count`, `simulator_accepted_at`, `last_topic`, `handoff_requested_at`, `flags` jsonb |
| `ai_runs` | telemetria e auditoria | `model`, `prompt_version`, `input_tokens`, `output_tokens`, `cost_usd`, `latency_ms`, `retrieved_chunk_ids` uuid[], `refused`, `error` |
| `kb_sources` | fonte curada | `title`, `kind` (`lei`/`ec`/`in`/`nota_tecnica`/`faq_invent`/`material_invent`), `authority` (`oficial`/`invent`/`secundaria`), `url`, `effective_from`, `effective_to`, `version`, `status`, `checksum` |
| `kb_chunks` | unidade de recuperação | `source_id`, `ord`, `heading` (dispositivo: "art. 12, §3º"), `content`, `embedding vector(n)`, `tsv tsvector`, `metadata` jsonb |
| `prompt_versions` | prompt versionado | `key`, `version`, `content`, `active`, `created_by` |
| `usage_counters` | rate limit e custo | `contact_id`, `day`, `messages`, `tokens`, `cost_usd` |
| `job_failures` | fila morta | `kind`, `payload` jsonb, `error`, `attempts`, `resolved_at` |
| `hubspot_outbox` | integração confiável | reaproveita o padrão já previsto em `lib/hubspot/` |

Datas em `timestamptz` UTC, render em `America/Sao_Paulo` (CLAUDE.md §8) — corrige o Europe/Lisbon
do fluxo atual.

## 5. Base de conhecimento (RAG)

**Curadoria é do time fiscal da Invent**, não do modelo. Pipeline:

1. `scripts/kb-ingest.ts` lê as fontes registradas em `kb_sources` (PDF/HTML/Markdown).
2. Chunking **estrutural**: por artigo/parágrafo/inciso na legislação, por seção nos materiais —
   não por contagem cega de caracteres. Cada chunk carrega o dispositivo em `heading`, o que
   permite citar "LC 214/2025, art. 12, §3º".
3. Embedding + `tsvector` em português; upsert idempotente por `checksum` (reprocessa só o que
   mudou).
4. Vigência em `effective_from`/`effective_to`: o retrieval filtra o que está vigente na data da
   pergunta e sinaliza regra que ainda vai entrar em vigor. Essencial na transição 2026-2033.
5. Console admin para incluir, versionar, desativar fonte e inspecionar o que foi citado em cada
   resposta.

Camadas de autoridade: `oficial` (texto normativo) > `invent` (material técnico próprio,
FAQ, simulador) > `secundaria` (imprensa especializada, apenas contexto, sempre marcada como tal).
Substitui a raspagem de `contabeis.com.br` como fonte primária (achado Q4).

**Corpus inicial a confirmar com o time fiscal** — versões e normas posteriores precisam ser
validadas antes da ingestão, não assumidas por este documento:

- EC 132/2023 (texto consolidado);
- LC 214/2025 e alterações posteriores vigentes;
- normas de regulamentação e notas técnicas aplicáveis (Comitê Gestor do IBS, RFB);
- cronograma de transição consolidado, com as alíquotas-teste e o calendário por ano;
- material próprio: FAQ da Invent, conteúdo do Simulador, notas do TaxPlus e do Comex;
- perguntas reais já recebidas no WhatsApp (só a partir da persistência da fase 1).

## 6. Guard-rails do agente

Aplicados no código, não só no prompt (CLAUDE.md §10):

- **Escopo**: fora de Reforma Tributária → recusa curta + reancoragem no tema.
- **Citação obrigatória**: afirmação normativa sem chunk de suporte é bloqueada na pós-validação;
  o agente refaz com recusa. Resposta sempre traz a fonte.
- **Sem número inventado**: alíquota, prazo e percentual só saem da tool `cronograma_reforma`
  (tabela versionada em `lib/tax/`) ou de citação literal da base.
- **Watermark**: "Resposta gerada por IA da Invent Software — pode conter erros; confirme com seu
  contador" no primeiro turno e ao final de resposta com número/prazo.
- **Sem parecer definitivo**: caso concreto → orienta e oferece consultor humano.
- **Rate limit** por contato/dia e teto de custo por conversa.
- **Opt-out** por palavra-chave ("sair", "parar", "cancelar") → `opt_out_at`, confirmação e fim.
- **Prompt versionado** em `prompt_versions`, com A/B e rollback; nunca editado em produção sem
  registro.

## 7. Conversão (o que o fluxo atual joga fora)

- Oferta do simulador com **estado real**: oferece quando o tema indica cálculo de impacto, no
  máximo 1x por janela configurável, respeita "não", registra aceite e clique. UTM em config, não
  no prompt (achados Q5, P5).
- **Lead no HubSpot** via outbox: telefone, nome, tema perguntado, segmento e ERP quando
  identificados, origem do canal, aceite do simulador. Consentimento granular gravado antes
  (CLAUDE.md §9).
- **Handoff humano**: "falar com um consultor" cria tarefa/deal no HubSpot, marca
  `status = handoff` e **silencia o bot** naquela conversa até liberação — resolve também o achado
  B9 (humano assumindo pelo mesmo número).
- **Métricas**: conversas, perguntas por tema, taxa de refusal, aceite do simulador, handoff, custo
  por conversa, latência p95.

## 8. Variáveis de ambiente (novas)

```
# WhatsApp — gateway Evolution (VPS/EasyPanel)
WHATSAPP_GATEWAY=evolution            # evolution | cloud_api
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=                   # allowlist da instância; nunca vazio (achado S3)
EVOLUTION_WEBHOOK_SECRET=             # token/HMAC do inbound (achados S1/S2)

# Fila / debounce
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
TURN_DEBOUNCE_SECONDS=7

# IA
AI_PROVIDER=                          # decisão D3
AI_MODEL=
AI_EMBEDDING_MODEL=
AI_MAX_TOKENS_PER_TURN=
RATE_LIMIT_MESSAGES_PER_DAY=50

# Conversão
SIMULATOR_URL=https://lp.inventsoftware.com.br/simulador-reforma-tributaria/
SIMULATOR_UTM=utm_source=ia+whatsapp+mkt&utm_campaign=simulador+da+reforma+tributaria
```

`DATABASE_URL` (6543), `DIRECT_URL` (5432), Supabase, HubSpot, Sentry e provedores de IA seguem o
`.env.example` já existente.

## 9. Fases

Cada fase entrega algo verificável; o n8n só é desligado no cutover.

| Fase | Escopo | Saída |
|------|--------|-------|
| **0 — hotfix no n8n** | token no webhook, validação de instância, ajuste do prompt Q1, timezone SP | risco agudo fora do ar, sem esperar migração |
| **1 — paridade correta** | skeleton, schema, inbound idempotente, normalização de todos os tipos de mensagem, debounce, dedupe, envio robusto, erro com fallback, persistência, rate limit | bot novo em número de teste, com log |
| **2 — base e guard-rails** | pgvector, ingestão curada, busca híbrida, citações, refusal, prompt v2 versionado, console de base | qualidade de resposta auditável |
| **3 — conversão e LGPD** | oferta do simulador com estado, HubSpot outbox, handoff humano, consentimento, opt-out, exportação/exclusão, dashboard | canal pronto para promoção |
| **4 — cutover** | webhook do Evolution aponta para o novo endpoint; n8n desativado e mantido 2 semanas como rollback | produção |
| **5 — evolução** | transcrição de áudio, eval set de perguntas com gabarito do time fiscal, widget web no site e na Universidade Invent, relatório de temas para marketing | escala |

Histórico do Redis (TTL de 3 dias) **não é migrado** — o novo bot começa com memória limpa.

## 10. Riscos

| Risco | Mitigação |
|-------|-----------|
| Ban do número (Evolution não é API oficial) | só responder a quem inicia, sem disparo em massa, rate limit, opt-out; decisão D2 sobre migrar para API oficial da Meta |
| Resposta tributária errada | citação obrigatória, cálculo em código, eval com gabarito fiscal, watermark, recusa como comportamento padrão |
| Custo de LLM | teto por conversa e por dia, cache de respostas frequentes, contexto enxuto via RAG (hoje o doc inteiro entra em cada chamada) |
| VPS como ponto único | healthcheck do Evolution, alerta de desconexão de instância, backup do container no EasyPanel |
| Base desatualizada na transição | `effective_from`/`effective_to` por chunk, revisão periódica registrada, aviso automático de fonte vencida |
| LGPD | consentimento granular, opt-out, retenção definida, disclosure de transferência internacional |

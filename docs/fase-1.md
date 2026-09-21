# Fase 1 — paridade correta em código

> **Status: implementada.** O que está em código e verificado (`pnpm typecheck && pnpm lint &&
pnpm test && pnpm build`, 70 testes) está marcado abaixo. Falta o que depende de ambiente real:
> aplicar as migrations num projeto Supabase, ligar QStash e apontar a instância de teste da
> Evolution para o novo webhook.

Objetivo: o bot novo rodando em **número de teste**, com o comportamento do n8n corrigido, tudo
persistido e observável. Sem RAG ainda (fase 2): a resposta usa a base de conhecimento provisória
e já recusa quando não tem respaldo.

Critério de pronto: uma conversa real de ponta a ponta no número de teste, com mensagens de todos
os tipos, sem resposta duplicada, sem resposta vazia e com tudo gravado em banco.

## Entregas

### 1. Bootstrap

- [x] `package.json` (Next 16, TS strict, Drizzle, postgres-js, zod, AI SDK 7, vitest, eslint)
- [x] `tsconfig.json`, `eslint.config.mjs` (flat config — `next lint` saiu no Next 16),
      `.prettierrc.json`, `next.config.ts`, `vitest.config.mts`
- [x] `.github/workflows/ci.yml` — typecheck + lint + test + migration em dia + build
- [x] `drizzle.config.ts` usando `DIRECT_URL`

### 2. Banco

- [x] `db/schema.ts` — `contacts`, `conversations`, `messages`, `conversation_state`, `ai_runs`,
      `usage_counters`, `job_failures`, `hubspot_outbox` (tabelas de KB ficam na fase 2)
- [x] `db/rls.sql` — RLS habilitado e forçado em todas, helpers `is_admin()` / `is_agent()`,
      default deny, função de anonimização para retenção
- [x] `db/client.ts` — postgres-js `max: 1`, `prepare: false`, lazy
- [x] `db/migrations/0000_*.sql` + `db/migrate.ts` + `db/apply-rls.ts`
- [x] unique em `(provider, provider_message_id)` de `messages` — base da idempotência

### 3. Gateway WhatsApp (`lib/whatsapp/`)

- [x] `types.ts` — `InboundMessage`, `ParseResult`, motivos de descarte, contrato do gateway
- [x] `gateway.ts` — porta: `verifyInbound`, `parseInbound`, `sendText`, `setTyping`
- [x] `evolution.ts` — Evolution API, token por header ou query, timeout e uma retentativa
- [x] `cloud-api.ts` — porta tipada que falha explícito, para não travar a migração futura
- [x] `normalize.ts` — todos os tipos de mensagem, envelopes efêmero/visualização única,
      filtros de grupo, broadcast e JID malformado (CLAUDE.md §6)
- [x] `split.ts` — quebra em blocos e conversão de `**negrito**` para o formato do WhatsApp
- [x] 46 testes em `normalize.test.ts` (33) e `split.test.ts` (13), portados de
      `legacy/tools/test-hotfix.mjs` e ampliados

### 4. Inbound (`app/api/whatsapp/inbound/route.ts`)

- [x] `runtime = "nodejs"`
- [x] valida segredo + instância, rejeita `fromMe` / grupo / broadcast / JID inválido
- [x] upsert de `contacts` e `conversations`, insert idempotente em `messages`
- [x] respeita `opt_out_at` e rate limit (avisa uma vez ao cruzar o limite)
- [x] publica job com delay de debounce; 200 em todo descarte para não gerar reentrega
- [ ] testes de rota ponta a ponta (exige stub do banco) — a lógica de parsing já tem cobertura

### 5. Fila (`lib/queue/turn.ts`)

- [x] `enqueueTurn` com delay de debounce e `deduplicationId` por conversa/janela
- [x] `verifyQueueRequest` com assinatura do QStash; sem chaves, nada entra
- [x] modo inline sem `QSTASH_TOKEN` para desenvolvimento, com aviso no log

### 6. Worker do turno (`app/api/jobs/turn/route.ts` + `lib/turn/run.ts`)

- [x] verifica assinatura da fila; `maxDuration = 60`
- [x] `claimPendingMessages` com `FOR UPDATE SKIP LOCKED` + `processed_at` na mesma transação
- [x] agrega as mensagens pendentes em UM turno
- [x] conversa em `handoff` ou contato com opt-out: consome o pendente e fica calado
- [x] opt-out por palavra-chave antes de qualquer chamada de modelo
- [x] mídia sem texto recebe o pedido de texto sem gastar chamada de modelo
- [x] presence "composing" antes de responder
- [x] grava `ai_runs` (modelo, versão do prompt, tokens, latência, refusal)
- [x] envia em blocos com pausa entre eles; falha final → fallback ao usuário + `job_failures`
- [ ] custo em dólar por run (`ai_runs.cost_usd` existe, o cálculo entra com a tabela de preços)

### 7. Agente (`lib/ai/`)

- [x] `agent.ts` — AI SDK 7, provider por env, `stopWhen: stepCountIs(5)`, uma retentativa
- [x] `prompt.ts` — prompt da fase 1 versionado (`PROMPT_VERSION`), estado do simulador vindo do
      banco em vez de "marcador interno"
- [x] `provider.ts` — Anthropic ou Google por env (decisão D3 sem travar a fase 1)
- [x] `tools/cronograma.ts` — única origem de número, lendo `lib/tax/schedule.ts`
- [x] `tools/simulador.ts` — entrega o link com UTM e registra oferta/aceite
- [x] `tools/handoff.ts` — marca handoff e silencia o bot (HubSpot na fase 3)
- [x] `guardrails.ts` + 18 testes — número sem respaldo cai na recusa, link fora da allowlist é
      removido, opt-out reconhecido sem confundir com pergunta
- [ ] `lib/tax/schedule.ts` precisa de **revisão do time fiscal**: `REVISAO_PENDENTE = true` faz a
      tool devolver aviso de conteúdo não homologado
- [ ] testes do agente com stub de modelo (escopo e recusa ponta a ponta)

### 8. Operação

- [x] `lib/observability/logger.ts` — porta única de log estruturado (Sentry na fase 3)
- [x] `docs/runbook.md` — rodar local, girar segredo, pausar o bot, reprocessar `job_failures`,
      investigar "o bot não respondeu", consultas de custo e volume

## Ordem sugerida

1. Bootstrap + CI (nada entra sem verificação)
2. Schema + RLS + migration
3. `normalize.ts` com os testes portados do hotfix
4. Inbound idempotente
5. Fila + debounce
6. Worker + envio robusto
7. Agente + guard-rails
8. Runbook e cutover para o número de teste

## Fora do escopo desta fase

RAG e base curada (fase 2), HubSpot e handoff (fase 3), console admin (fase 3), transcrição de
áudio (fase 5) — áudio recebe a resposta pedindo texto, como no hotfix.

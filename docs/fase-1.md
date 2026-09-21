# Fase 1 — paridade correta em código

Objetivo: o bot novo rodando em **número de teste**, com o comportamento do n8n corrigido, tudo
persistido e observável. Sem RAG ainda (fase 2): a resposta usa a base de conhecimento provisória
e já recusa quando não tem respaldo.

Critério de pronto: uma conversa real de ponta a ponta no número de teste, com mensagens de todos
os tipos, sem resposta duplicada, sem resposta vazia e com tudo gravado em banco.

## Entregas

### 1. Bootstrap
- `package.json` (Next 15, TS strict, Drizzle, postgres-js, zod, ai, vitest, eslint, prettier)
- `tsconfig.json`, `.eslintrc.json`, `.prettierrc.json`, `next.config.ts`, `vitest.config.ts`
- `.github/workflows/ci.yml` — typecheck + lint + test + drizzle migration check
- `drizzle.config.ts` usando `DIRECT_URL`

### 2. Banco
- `db/schema.ts` — `contacts`, `conversations`, `messages`, `conversation_state`, `ai_runs`,
  `usage_counters`, `job_failures`, `hubspot_outbox` (tabelas de KB ficam na fase 2)
- `db/rls.sql` — RLS forçado em todas, helpers `is_admin()` / `is_agent()`, default deny
- `db/client.ts` — postgres-js `max: 1`, `prepare: false`, lazy
- `db/migrations/` — primeira migration gerada
- índice único em `(provider, provider_message_id)` de `messages` — base da idempotência

### 3. Gateway WhatsApp (`lib/whatsapp/`)
- `types.ts` — `InboundMessage` normalizada, `OutboundMessage`, erros do gateway
- `gateway.ts` — porta: `verifyInbound`, `parseInbound`, `sendText`, `setPresence`
- `evolution.ts` — implementação Evolution API
- `cloud-api.ts` — stub tipado, para não travar a migração futura
- `normalize.ts` — **a parte mais importante**: todos os tipos de mensagem (CLAUDE.md §6).
  Porta o código já testado em `legacy/tools/test-hotfix.mjs` para TypeScript, com os mesmos casos
  em Vitest.

### 4. Inbound (`app/api/whatsapp/inbound/route.ts`)
- `runtime = "nodejs"`
- valida segredo + instância, rejeita `fromMe` / grupo / broadcast / JID inválido
- upsert de `contacts` e `conversations`, insert idempotente em `messages`
- respeita `opt_out_at` e rate limit antes de enfileirar
- publica job com delay de debounce; responde 200 sempre, em < 300ms
- testes: payload de cada tipo, reentrega do mesmo `provider_message_id`, token inválido, grupo

### 5. Fila (`lib/queue/`)
- `publish.ts` / `verify.ts` (assinatura QStash)
- debounce por conversa: job com delay, worker agrega o que chegou na janela

### 6. Worker do turno (`app/api/jobs/turn/route.ts`)
- verifica assinatura da fila; `maxDuration` compatível com o plano da Vercel
- lock por conversa (`FOR UPDATE SKIP LOCKED`); agrega mensagens não processadas em um turno
- presence "composing" no gateway
- chama o agente (`lib/ai/agent.ts`) com o prompt da fase 1
- grava `ai_runs` (modelo, tokens, custo, latência, refusal)
- envia resposta em blocos < 1000 caracteres, com retry
- em falha final: mensagem de fallback ao usuário + `job_failures` + Sentry

### 7. Agente (`lib/ai/`)
- `agent.ts` — AI SDK, provider por env, `maxSteps` limitado
- `prompt.ts` — prompt da fase 1 (versão de `docs/prompt-v2.md` sem as tools de RAG)
- `tools/cronograma.ts` — tabela versionada em `lib/tax/`, única origem de número
- `guardrails.ts` — pós-validação: número sem citação, URL fora da allowlist, escopo
- testes: escopo, recusa, formatação WhatsApp (nunca `**`), bloqueio de número sem respaldo

### 8. Operação
- `lib/observability/` — Sentry + métricas de custo e latência
- `docs/runbook.md` — girar segredo, reprocessar `job_failures`, pausar o bot, rollback para o n8n

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

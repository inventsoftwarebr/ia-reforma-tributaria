# CLAUDE.md — IA da Reforma Tributária (Invent Software)

Lido por toda sessão Claude neste repositório. As regras abaixo vêm da auditoria do fluxo n8n
original (`docs/auditoria-n8n.md`) — cada uma existe porque um bug real foi encontrado.

## O que é este projeto

Agente de WhatsApp da **Invent Software** que responde dúvidas sobre a Reforma Tributária
(EC 132/2023, LC 214/2025 e normas subsequentes) e converte interesse em lead qualificado / uso do
Simulador da Reforma Tributária.

Stack: Next.js 15 App Router + TypeScript strict + Tailwind + shadcn/ui + Drizzle ORM +
Supabase (Postgres/Auth/pgvector) + Evolution API (gateway WhatsApp, VPS/EasyPanel) +
Vercel AI SDK + QStash (fila/debounce) + HubSpot + Sentry. Hospedagem Vercel.

Desenho completo em `docs/arquitetura.md`. Prompt em `docs/prompt-v2.md`.

## Regras invioláveis

### 1. Nunca inventar matéria tributária

Afirmação sobre regra, prazo, alíquota, crédito ou obrigação **só sai com respaldo** em chunk da
base curada ou na tool `cronograma_reforma`. Sem respaldo, o agente recusa e oferece contato
humano. Recusa é comportamento correto, não falha.

O prompt do fluxo antigo mandava "nunca diga que não tem informação" — é exatamente o que este
projeto não faz. Não reintroduza esse comportamento em nome de "parecer mais útil".

### 2. Citação obrigatória

Toda afirmação normativa carrega fonte + dispositivo (`LC 214/2025, art. 12`). A pós-validação
bloqueia resposta com número/prazo sem citação e refaz. Fonte `secundaria` (imprensa) nunca é
apresentada como norma.

### 3. Número é código, não LLM

Alíquota, percentual, fase e data vêm de `lib/tax/` (tabela versionada, revisada pelo time fiscal)
ou de citação literal. O modelo não calcula alíquota. Simulação de caso concreto é do Simulador.

### 4. Estado em Postgres, nunca no prompt

Oferta do simulador, handoff, opt-out e rate limit são colunas em `conversation_state` /
`contacts` / `usage_counters`. Não instrua o modelo a "manter um marcador interno" — LLM não tem
estado entre turnos.

### 5. Webhook de entrada é hostil até prova em contrário

`app/api/whatsapp/inbound` **sempre**:

1. valida segredo (HMAC/token) e instância contra allowlist;
2. rejeita `fromMe`, `@g.us`, `@broadcast`, `status@broadcast` e JID malformado;
3. nunca confia no destinatário vindo do corpo — só envia para JID validado e persistido;
4. `INSERT ... ON CONFLICT (provider, provider_message_id) DO NOTHING` antes de qualquer trabalho;
5. responde 200 em < 300ms; trabalho pesado vai para a fila.

O fluxo antigo aceitava POST anônimo e usava o `remoteJid` do corpo como destinatário — qualquer
um podia fazer o número oficial da Invent enviar mensagem para terceiros.

### 6. Toda mensagem do WhatsApp é normalizada

Trate `conversation`, `extendedTextMessage`, `imageMessage`/`videoMessage` (legenda),
`buttonsResponseMessage`, `listResponseMessage`, `templateButtonReplyMessage`, `audioMessage`,
`documentMessage`, `stickerMessage`, `locationMessage`, `reactionMessage` e `protocolMessage`.
Tipo sem texto aproveitável recebe resposta pedindo texto — nunca chega vazio ao modelo.

### 7. Debounce antes de responder

Mensagens do mesmo contato dentro de `TURN_DEBOUNCE_SECONDS` viram **um** turno. Lock por conversa
(`FOR UPDATE SKIP LOCKED`) impede dois workers respondendo em paralelo.

### 8. Silêncio nunca é resultado aceitável

Falha de LLM, fila, banco ou gateway → retry; em falha final, mensagem de fallback ao usuário,
registro em `job_failures` e alerta Sentry.

### 9. Conexão Postgres — Supavisor transaction mode (6543)

`DATABASE_URL` aponta para o pooler na porta **6543**. `DIRECT_URL` (5432) só para `drizzle-kit`.
Drizzle com `postgres-js`, `max: 1`, `prepare: false`.

### 10. RLS default-deny em todas as tabelas

Política explícita em `db/rls.sql` **no mesmo commit** que cria/altera a tabela. Conversa e
contato são dados pessoais: leitura só para `is_admin()` / `is_agent()`. Service role nunca vai
para o browser.

### 11. Runtime Node

Nada de `runtime = "edge"` onde há Postgres, `postgres-js` ou SDK de IA. Ver limites de tempo de
função na Vercel ao definir `maxDuration` do worker.

### 12. Datas e timezone

`timestamptz` UTC no banco, render em `America/Sao_Paulo`, UI em `DD/MM/YYYY`. O fluxo antigo usava
`Europe/Lisbon` e informava a data errada — em um agente que fala de prazos, isso é resposta errada.

### 13. LGPD não é opcional

Consentimento granular registrado antes de enviar lead ao HubSpot. Opt-out por palavra-chave
("sair", "parar", "cancelar") → `opt_out_at` e fim do atendimento. Retenção definida, exportação e
exclusão a pedido, disclosure de transferência internacional (provedores de IA).

### 14. Gateway WhatsApp é porta trocável

Todo acesso ao WhatsApp passa por `lib/whatsapp/gateway.ts`. Implementações em
`lib/whatsapp/evolution.ts` e `lib/whatsapp/cloud-api.ts`. Nenhuma rota chama a Evolution direto.

### 15. Prompt versionado

Prompt vive em `prompt_versions` e é referenciado por `prompt_version` em `ai_runs`. Mudança de
prompt é commit + registro, nunca edição direta em produção.

## Convenções de código

- Código em **inglês** (tabela, função, variável). Strings de UI e do agente em **pt-BR**.
- Sem `any`: `unknown` + narrowing.
- Sem `console.log` em produção — Sentry.
- Server Actions e Route Handlers validam input com Zod no servidor.
- Components PascalCase; utils kebab-case.
- Comentário só onde o "porquê" não é óbvio.

## Estrutura

```
app/
  api/whatsapp/inbound/     webhook do gateway (idempotente)
  api/jobs/turn/            worker do turno (assinado pelo QStash)
  (admin)/                  console: conversas, base, prompt, métricas
lib/
  whatsapp/                 gateway (porta) + evolution + cloud-api
  ai/                       agente, tools, retrieval, pós-validação
  kb/                       ingestão, chunking, embeddings
  tax/                      cronograma e alíquotas versionadas
  hubspot/                  cliente + outbox drainer
  queue/                    publish/consume + debounce
db/
  schema.ts                 Drizzle (single source of truth)
  rls.sql                   políticas + helpers + triggers
  migrations/
docs/                       auditoria, arquitetura, prompt, fases
legacy/                     fluxo n8n original + hotfix + ferramentas
```

## Antes de commitar

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Armadilhas

- **"O agente respondeu fora de contexto."** Provavelmente mensagem não-texto chegou vazia. Ver §6.
- **"Respondeu três vezes."** Debounce ou lock de conversa. Ver §7.
- **"Respondeu duplicado depois de reconectar o WhatsApp."** Idempotência por `provider_message_id`. Ver §5.
- **"Query do Drizzle vem vazia."** RLS sem JWT ou sem política.
- **"Timeout na Vercel."** Porta 5432 em vez de 6543, ou Drizzle sem `max:1, prepare:false`.
- **"O agente inventou uma alíquota."** Pós-validação furada ou tool de cronograma não chamada. Ver §1 e §3.

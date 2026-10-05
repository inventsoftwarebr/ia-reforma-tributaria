# CLAUDE.md — IA da Reforma Tributária (Invent Software)

Lido por toda sessão Claude neste repositório.

## O que é

Agente de WhatsApp que responde dúvidas sobre a Reforma Tributária citando a norma, e converte
interesse em lead qualificado / uso do Simulador da Reforma Tributária da Invent.

Stack: Next.js 16 App Router + TypeScript strict + Drizzle + Supabase (Postgres, pgvector, Auth)
+ Evolution API (gateway WhatsApp, VPS/EasyPanel) + Vercel AI SDK + QStash + HubSpot.
Hospedagem Vercel.

Fluxo: `POST /api/whatsapp/inbound` grava e enfileira → `POST /api/jobs/turn` agrega o turno,
busca na base, chama o modelo, valida e responde → `GET /api/cron/outbox` drena o HubSpot.

## Regras invioláveis

### 1. Nunca inventar matéria tributária

Afirmação sobre regra, prazo, alíquota, crédito ou obrigação só sai com respaldo: trecho
recuperado da base ou a tool `cronograma_reforma`. Sem respaldo, o agente recusa e oferece
contato humano. **Recusa é comportamento correto, não falha** — e recusa alta num tema é sinal de
lacuna de curadoria, visível no painel.

### 2. Citação verificada, não apenas pedida

`lib/ai/guardrails.ts` extrai as normas citadas na resposta e compara com as que foram
efetivamente recuperadas. Citação de norma que não veio da base é descartada como invenção —
citação falsa é pior que resposta sem citação, porque parece confiável.

### 3. Número é código, não LLM

Alíquota, percentual, fase e data vêm de `lib/tax/schedule.ts` (revisão fiscal pendente enquanto
`REVISAO_PENDENTE = true`) ou de citação literal. O modelo não calcula alíquota. Simulação de caso
concreto é do Simulador.

### 4. Retrieval filtra por vigência

`kb_search` (em `db/functions.sql`) descarta fonte fora da vigência na data da pergunta. Norma
revogada não sustenta resposta. Toda fonte declara `authority`: `secundaria` (imprensa) é contexto,
nunca norma.

### 5. Estado em Postgres, nunca no prompt

Oferta do simulador, handoff, opt-out e rate limit são colunas. Não instrua o modelo a "manter um
marcador interno" — LLM não tem estado entre turnos.

### 6. Webhook de entrada é hostil até prova em contrário

`app/api/whatsapp/inbound` sempre: valida segredo e instância; rejeita `fromMe`, `@g.us`,
`@broadcast` e JID malformado; nunca confia no destinatário vindo do corpo; grava com
`ON CONFLICT DO NOTHING` por `(provider, provider_message_id)` antes de qualquer trabalho;
responde 200 rápido e joga o resto para a fila.

### 7. Toda mensagem do WhatsApp é normalizada

`lib/whatsapp/normalize.ts` trata texto, texto citado, botão, lista, legenda de imagem e vídeo,
áudio, documento, sticker, localização, além dos envelopes efêmero e de visualização única. Tipo
sem texto aproveitável recebe resposta pedindo texto — nada chega vazio ao modelo.

### 8. Debounce e lock antes de responder

Mensagens do mesmo contato na janela de `TURN_DEBOUNCE_SECONDS` viram **um** turno
(`deduplicationId` do QStash). `claimPendingMessages` usa `FOR UPDATE SKIP LOCKED` e marca
`processed_at` na mesma transação. Conversa em `handoff` consome o pendente e fica calada.

### 9. Silêncio nunca é resultado aceitável

Falha de modelo, fila, banco ou gateway → retry; em falha final, mensagem de fallback ao usuário,
registro em `job_failures` e log de erro.

### 10. Conexão Postgres — pooler na 6543

`DATABASE_URL` aponta para o Supavisor em transaction mode (6543), com `postgres-js`, `max: 1`,
`prepare: false`. `DIRECT_URL` (5432) só para `drizzle-kit` e scripts.

### 11. RLS default-deny em todas as tabelas

Política explícita em `db/rls.sql` **no mesmo commit** que cria ou altera a tabela. O console e o
pipeline leem pela conexão Postgres (papel `postgres`, que tem BYPASSRLS no Supabase) — por isso
**toda página e toda Server Action chama `requireAgent()`/`requireAdmin()`**. O RLS é a segunda
camada, para acesso direto à API do Supabase. A chave secreta do Supabase não é usada pelo código.

Duas armadilhas que já aconteceram aqui, cobertas por `scripts/verify-rls.sql` no CI:

- função usada em política que lê tabela protegida precisa ser `security definer`, senão a
  política se reavalia em recursão infinita (`app_role()` lendo `profiles`);
- política de "editar a própria linha" libera todas as colunas — em `profiles`, isso deixava
  qualquer atendente se promover a admin. Não recrie.

### 12. Runtime Node

Nada de `runtime = "edge"` onde há Postgres, `postgres-js` ou AI SDK.

### 13. Datas e timezone

`timestamptz` UTC no banco, render em `America/Sao_Paulo` (`lib/time.ts`), UI em `DD/MM/YYYY`.

### 14. LGPD não é opcional

Consentimento do primeiro contato registrado em `contacts.consent`; aviso de IA na primeira
resposta; opt-out por palavra-chave ("sair", "parar", "cancelar") antes de qualquer chamada de
modelo; `anonymize_old_messages()` para retenção.

### 15. Gateway WhatsApp é porta trocável

Todo acesso passa por `lib/whatsapp/gateway.ts`. Implementações em `evolution.ts` e
`cloud-api.ts`. Nenhuma rota chama a Evolution direto.

### 16. Prompt tem duas partes

**Política** (`lib/ai/prompt.ts` ou a versão ativa em `prompt_versions`): tom, escopo, regras —
ajustável pelo console. **Contexto** (trechos e estado): montado sempre em código, para o console
não conseguir afrouxar o que os guard-rails dependem.

## Convenções de código

- Código em **inglês**; strings de UI e do agente em **pt-BR**.
- Sem `any`: `unknown` + narrowing.
- Sem `console.log`: `lib/observability/logger.ts` é a única porta de log.
- Route Handler e Server Action validam input com Zod.
- Componentes PascalCase; utilitários kebab-case.
- Comentário só onde o "porquê" não é óbvio.

## Estrutura

```
app/
  api/whatsapp/inbound/     webhook do gateway (idempotente)
  api/jobs/turn/            worker do turno (assinado pela fila)
  api/cron/outbox/          drenagem do HubSpot
  admin/                    console: painel, conversas, base, prompt
  entrar/                   login do console
lib/
  whatsapp/                 gateway + normalização + split
  ai/                       agente, prompt, guard-rails, tools
  kb/                       chunking, embeddings, busca, ingestão
  tax/                      cronograma versionado (revisão fiscal)
  conversations/            repositório do pipeline
  hubspot/                  cliente + outbox
  admin/                    autorização, queries e actions do console
  queue/, turn/, supabase/, observability/, env.ts, time.ts
db/
  schema.ts                 Drizzle (single source of truth)
  extensions.sql            pgvector, pg_trgm
  functions.sql             tsvector, índices HNSW/GIN, kb_search
  rls.sql                   políticas + helpers + trigger
  bootstrap.sql             GERADO: tudo junto para o SQL Editor
kb/                         manifesto e documentos da base
scripts/                    ingestão, gerador do bootstrap, verificação SQL
```

## Antes de commitar

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

O CI roda os quatro, verifica migration/bootstrap em dia e aplica o SQL num Postgres com pgvector,
conferindo RLS, idempotência e a busca com filtro de vigência.

## Armadilhas

- **"O agente recusa tudo."** A base está vazia ou sem vigência válida. Ver `/admin/base`.
- **"Respondeu fora de contexto."** Mensagem não-texto chegou vazia. Ver §7.
- **"Respondeu três vezes."** Debounce ou lock. Ver §8.
- **"Duplicou depois de reconectar o WhatsApp."** Idempotência por `provider_message_id`. Ver §6.
- **"Query do Drizzle vem vazia."** RLS sem JWT, ou política ausente.
- **"Timeout na Vercel."** Porta 5432 em vez de 6543, ou Drizzle sem `max:1, prepare:false`.
- **"A resposta citou norma errada."** Guard-rail de citação: confira `ai_runs.refusal_reason` e o
  rótulo de citação da fonte no manifesto.

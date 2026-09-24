# IA da Reforma Tributária — Invent Software

Agente de WhatsApp que atende e tira dúvidas sobre a Reforma Tributária brasileira, respondendo
**com citação da norma** e recusando quando não tem respaldo. Converte interesse em lead
qualificado no HubSpot e em uso do Simulador da Reforma Tributária da Invent.

## Como funciona

```
WhatsApp ──> Evolution API ──> POST /api/whatsapp/inbound
                                 valida segredo, normaliza qualquer tipo de
                                 mensagem, grava idempotente, enfileira
                                        │
                              QStash (debounce ~7s)
                                        │
                                POST /api/jobs/turn
                                 agrega as mensagens em um turno
                                 busca híbrida na base curada (pgvector + texto,
                                   filtrada por vigência)
                                 modelo responde com as ferramentas
                                 guard-rails validam citação e número
                                 envia em blocos pelo gateway
                                        │
                        GET /api/cron/outbox ──> HubSpot
```

Console em `/admin`: painel, conversas com transcrição, base de conhecimento e versões do prompt.

## O que impede o agente de inventar

| Proteção | Onde |
| --- | --- |
| Responde só com o que foi recuperado da base | `lib/ai/prompt.ts` + contexto montado em código |
| Citação conferida contra o que foi realmente recuperado | `lib/ai/guardrails.ts` |
| Número só da base ou da tabela versionada | `lib/tax/schedule.ts` + tool `cronograma_reforma` |
| Norma revogada fora do retrieval | filtro de vigência em `kb_search` |
| Imprensa nunca vale como norma | `authority` da fonte, explícito no contexto |
| Link só de domínio autorizado | `stripDisallowedLinks` |
| Recusa medida por motivo | `ai_runs.refusal_reason`, visível no painel |

## Rodar

```bash
pnpm install
cp .env.example .env.local     # preencha; ver docs/setup.md
pnpm db:migrate && pnpm db:sql # ou cole db/bootstrap.sql no SQL Editor
pnpm kb:ingest                 # base curada (kb/README.md)
pnpm dev
```

Verificação completa:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| [`docs/setup.md`](docs/setup.md) | passo a passo de Supabase, Vercel, Evolution, QStash e HubSpot |
| [`docs/runbook.md`](docs/runbook.md) | operar: pausar o bot, investigar falha, girar segredo, custo |
| [`kb/README.md`](kb/README.md) | como a base de conhecimento é alimentada e curada |
| [`CLAUDE.md`](CLAUDE.md) | regras invioláveis do projeto |

## Pendências de dono

- **Curadoria da base** (time fiscal): quais normas, em que versão, com que periodicidade de
  revisão. Enquanto a base estiver vazia, o agente recusa tudo que dependa de norma.
- **`lib/tax/schedule.ts`**: `REVISAO_PENDENTE = true` até o time fiscal conferir linha por linha.
  Enquanto isso, toda resposta com número sai com aviso de conteúdo não homologado.
- **Pipeline do HubSpot** que recebe o lead do WhatsApp.

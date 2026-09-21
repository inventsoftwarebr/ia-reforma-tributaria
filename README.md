# IA da Reforma Tributária — Invent Software

Agente de WhatsApp que responde dúvidas sobre a Reforma Tributária brasileira e converte
interesse em lead qualificado / uso do Simulador da Reforma Tributária da Invent.

**Status:** fase 1 implementada em código (paridade corrigida com o fluxo n8n: entrada
idempotente, normalização de todos os tipos de mensagem, debounce, guard-rails, persistência e
runbook). O agente **em produção ainda é o workflow n8n** (`legacy/n8n-mudanca-fiscal.json`),
ligado à Evolution API numa VPS/EasyPanel — o novo só assume no cutover, depois de rodar em
número de teste.

Pendente de ambiente, não de código: projeto Supabase com as migrations e o RLS aplicados,
QStash ligado, instância de teste da Evolution apontando para `/api/whatsapp/inbound`, e a
**revisão do time fiscal** em `lib/tax/schedule.ts` (hoje `REVISAO_PENDENTE = true`).

## Por onde começar

| Documento | Conteúdo |
| --- | --- |
| [`docs/auditoria-n8n.md`](docs/auditoria-n8n.md) | o que o fluxo atual faz + 31 achados com severidade |
| [`docs/arquitetura.md`](docs/arquitetura.md) | stack, fluxo alvo, schema, RAG, guard-rails, env vars, fases, riscos |
| [`docs/prompt-v2.md`](docs/prompt-v2.md) | system prompt reescrito, ferramentas e pós-validação |
| [`docs/fase-1.md`](docs/fase-1.md) | primeira entrega em código, com o que está pronto e o que falta |
| [`docs/passo-a-passo.md`](docs/passo-a-passo.md) | **comece aqui** — o que precisa ser feito, parte por parte |
| [`docs/runbook.md`](docs/runbook.md) | rodar local, girar segredo, pausar o bot, investigar falha |
| [`legacy/HOTFIX.md`](legacy/HOTFIX.md) | correção imediata para aplicar no n8n hoje |
| [`CLAUDE.md`](CLAUDE.md) | regras invioláveis do projeto |

## Verificar

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Passo a passo de ambiente em [`docs/runbook.md`](docs/runbook.md).

## Decisões travadas

| # | Decisão |
| --- | --- |
| D1 | Repositório dedicado, separado da plataforma de cursos |
| D2 | Gateway WhatsApp abstraído (`lib/whatsapp/gateway.ts`); Evolution API agora, Cloud API da Meta sem reescrita |
| D3 | LLM e embeddings definidos na fase 2, com eval set; provider trocável pelo AI SDK |
| D4 | Runtime na Vercel (conta Pro da Invent); a VPS/EasyPanel segue só com o Evolution API |

## Pendências de dono

- **Curadoria da base de conhecimento** — time fiscal da Invent: quais normas, em que versão, com
  que periodicidade de revisão.
- **Pipeline do HubSpot** que recebe o lead vindo do WhatsApp.

## Ação imediata no fluxo atual

Dois riscos não esperam a migração: webhook sem autenticação com destinatário vindo do corpo da
requisição, e prompt que proíbe o modelo de admitir desconhecimento em matéria tributária. A
correção está pronta em [`legacy/HOTFIX.md`](legacy/HOTFIX.md).

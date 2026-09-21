# IA da Reforma Tributária — Invent Software

Agente de WhatsApp que responde dúvidas sobre a Reforma Tributária brasileira e converte
interesse em lead qualificado / uso do Simulador da Reforma Tributária da Invent.

**Status:** migração em preparação. O agente em produção ainda é o workflow n8n original
(`legacy/n8n-mudanca-fiscal.json`), ligado à Evolution API numa VPS/EasyPanel.

## Por onde começar

| Documento | Conteúdo |
|-----------|----------|
| [`docs/auditoria-n8n.md`](docs/auditoria-n8n.md) | o que o fluxo atual faz + 31 achados com severidade |
| [`docs/arquitetura.md`](docs/arquitetura.md) | stack, fluxo alvo, schema, RAG, guard-rails, env vars, fases, riscos |
| [`docs/prompt-v2.md`](docs/prompt-v2.md) | system prompt reescrito, ferramentas e pós-validação |
| [`docs/fase-1.md`](docs/fase-1.md) | plano de implementação da primeira entrega em código |
| [`legacy/HOTFIX.md`](legacy/HOTFIX.md) | correção imediata para aplicar no n8n hoje |
| [`CLAUDE.md`](CLAUDE.md) | regras invioláveis do projeto |

## Decisões travadas

| # | Decisão |
|---|---------|
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

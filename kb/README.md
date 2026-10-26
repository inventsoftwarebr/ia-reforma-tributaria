# Base de conhecimento

O agente responde **só** com o que está aqui. Base vazia significa agente que recusa tudo — o
que é o comportamento correto, mas não atende ninguém.

## Como adicionar um documento

**Pelo console (recomendado):** `/admin/base`.

- **Normas oficiais**: EC 132/2023 e LC 214/2025 importam com um clique, direto do Planalto
  (`lib/kb/official.ts`). O texto revogado (riscado no site) é descartado.
- **Adicionar fonte**: link de site (gov.br/leg.br entram como "oficial"), arquivo (PDF, Word,
  página salva `.html`, `.txt`, `.md`, até 4 MB) ou texto colado. Mesmo título = nova versão da
  mesma fonte.
- **Pacote inicial**: FAQ e institucional da Invent (`lib/kb/starter.ts`), como rascunho.

Fontes com **atualização diária** são conferidas pelo cron (`/api/cron/outbox`): se o texto do
site mudou, a base é atualizada, só os trechos alterados são reprocessados e a fonte volta a "sem
revisão". Depois de adicionar, teste no **Simulador**.

**Pela linha de comando:** converta para Markdown/texto, descreva em `kb/manifest.json` (copie de
`manifest.example.json`) e rode `pnpm kb:ingest`. Idempotente por checksum.

## Campos do manifesto

| Campo | Para que serve |
| --- | --- |
| `slug` | chave estável do documento; não mude depois de ingerir |
| `citationLabel` | como a fonte aparece na resposta: `LC 214/2025`, `EC 132/2023` |
| `authority` | `oficial` (norma), `invent` (material próprio), `secundaria` (imprensa) |
| `shape` | `legal` corta por artigo e parágrafo; `markdown` corta por seção |
| `effectiveFrom` / `effectiveTo` | vigência: o retrieval descarta o que não valia na data da pergunta |
| `reviewedBy` | quem do time fiscal conferiu. Fonte sem revisão aparece marcada no console |

## Por que a autoridade importa

O agente é instruído a nunca apresentar fonte `secundaria` como norma, e a verificação de
citação só aceita normas que realmente foram recuperadas. Rotular um blog como `oficial`
contorna as duas proteções — não faça isso.

## Formato do texto

Para norma, mantenha a numeração original (`Art. 12`, `§ 1º`): é dela que sai a citação
`LC 214/2025, art. 12, §1º`. Para material próprio, use cabeçalhos Markdown — cada seção vira um
trecho e o cabeçalho vira a referência.

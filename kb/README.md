# Base de conhecimento

O agente responde **só** com o que está aqui. Base vazia significa agente que recusa tudo — o
que é o comportamento correto, mas não atende ninguém.

## Como adicionar um documento

1. Converta para **Markdown ou texto puro** e salve nesta pasta. PDF não é lido pela ingestão:
   converta antes (o Claude Code faz isso, ou qualquer conversor).
2. Descreva o documento em `kb/manifest.json` (copie de `manifest.example.json`).
3. Rode `pnpm kb:ingest`.

A ingestão é idempotente por checksum: rodar de novo só reprocessa o que mudou.

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

# Hotfix do fluxo n8n — aplicar hoje

`n8n-hotfix-mudanca-fiscal.json` é o fluxo atual corrigido nos pontos que não devem esperar a
migração. `n8n-mudanca-fiscal.json` é o original, congelado para referência.

## O que foi corrigido

| Achado | Correção |
|--------|----------|
| S1, S2 | Node `1 - Validar e Normalizar` valida um segredo compartilhado (header `x-invent-token` ou `?token=`) antes de qualquer processamento. Sem isso, um POST forjado fazia a instância da Invent enviar WhatsApp para qualquer número, porque o destinatário vinha do corpo da requisição. |
| S3 | O node de envio agora usa `{{ $json.instancia }}` — a instância validada na entrada — em vez do `instanceName` vazio. |
| B1 | Normalização de **todos** os tipos: texto, texto citado/com link, botão, lista, legenda de imagem e vídeo. Áudio, documento, sticker e localização recebem resposta pedindo o texto, em vez de chegarem vazios ao agente. |
| B2 | Removido o `Code` que esperava um Merge inexistente (`inputs[1]`), junto com `leadGeral`, `sheet_data` e `action` — herança morta de outro workflow. |
| B3 | Timezone `Europe/Lisbon` → `America/Sao_Paulo`, no node de entrada e na tool Date & Time. |
| B4 | O envio usava `$json.message`, que não existia no caminho `action_json` → mensagem vazia ao cliente. O normalizador de saída agora sempre entrega `message` com texto, com fallback. |
| B5 | Removidos o regex guloso `/{[\s\S]*}/` e o `replace(/\/\/.*$/gm)`, que apagava tudo após `//` — inclusive dentro de URLs, justamente no fluxo que envia o link do simulador. |
| B6 | JID validado com `^[0-9]{10,15}@s\.whatsapp\.net$`: grupo, lista de transmissão e status ficam fora. |
| Q1, Q2 | System prompt reescrito: recusa com oferta de especialista em vez de "nunca diga que não tem informação", citação obrigatória da fonte, proibição de estimar alíquota de cabeça. |
| Q4 | A tool de site continua disponível, mas descrita como fonte secundária que nunca vale como norma. |
| Q5 | Oferta do simulador limitada a uma vez por conversa, com instrução explícita de respeitar recusa (controle real de estado só vem no projeto novo). |
| Q7 | `maxIterations: 8` no agente. |
| Q8 | Prompt em texto legível, não mais um JSON serializado dentro de uma string. |
| — | Bônus: `**negrito**` do markdown convertido para `*negrito*`, que é o que o WhatsApp entende. |

**Fora do escopo do hotfix** (fica para a fase 1 do projeto novo, porque exige estado em banco):
deduplicação por `provider_message_id` (B7), debounce de mensagens em sequência (B8), pausa do bot
no handoff humano (B9), rate limit (S4), persistência, captura de lead e LGPD.

## Convivência com o fluxo atual

O hotfix usa o path `ia-whatsappinvent-v2`, diferente do `ia-whatsappinvent` do fluxo antigo.
Isso é de propósito: o n8n não deixa dois workflows **ativos** dividirem o mesmo path. Com paths
diferentes você ativa e testa o hotfix com o atual ainda no ar, e a virada é só trocar a URL do
webhook na Evolution — o rollback é apontar de volta.

## Como aplicar

1. **Backup:** no n8n, duplique o workflow atual antes de qualquer coisa.
2. **Importar:** n8n → Workflows → Import from File → `n8n-hotfix-mudanca-fiscal.json`. Ele entra
   como *MUDANÇA FISCAL - Invent (hotfix)*, desativado.
3. **Reconectar credenciais** (os ids vêm do export, confirme cada uma): Evolution, Redis, Google
   Gemini e Google Docs.
4. **Definir o segredo:** abra o node `1 - Validar e Normalizar` e preencha

   ```js
   const EXPECTED_TOKEN = 'cole-aqui-um-segredo-forte';
   const ALLOWED_INSTANCES = ['nome-da-instancia-no-evolution'];
   ```

   Gere o segredo com `openssl rand -hex 32`. **Enquanto `EXPECTED_TOKEN` estiver vazio a checagem
   é ignorada** — isso é intencional, para a importação não derrubar o bot antes do passo 5.
5. **Ativar o hotfix.** Com path diferente, ele pode ficar ativo junto com o antigo. A URL de
   produção do webhook só funciona com o workflow ativo — no n8n, `/webhook/...` exige ativo,
   `/webhook-test/...` é o de teste manual.
6. **Testar sem tocar na Evolution**, chamando a URL de produção direto. Use **o seu próprio
   número** no `remoteJid`, porque é para ele que a resposta vai:

   ```bash
   curl -X POST "https://<seu-n8n>/webhook/ia-whatsappinvent-v2?token=<segredo>" \
     -H 'content-type: application/json' \
     -d '{"instance":"<sua-instancia>","data":{
           "key":{"remoteJid":"55SEUNUMERO@s.whatsapp.net","id":"TESTE-1","fromMe":false},
           "pushName":"Teste","message":{"conversation":"O que muda em 2026?"}}}'
   ```

   Confira, nesta ordem: sem `?token=` nada acontece; com token errado nada acontece; com token
   certo chega resposta no seu WhatsApp; trocando `conversation` por
   `"audioMessage":{"seconds":5}` você recebe o pedido de texto; trocando o `remoteJid` por um
   `@g.us` nada acontece.
7. **Virar a chave:** na Evolution, mude a URL do webhook da instância para
   `https://<seu-n8n>/webhook/ia-whatsappinvent-v2?token=<segredo>`, mantendo o evento
   `MESSAGES_UPSERT`. Se a sua versão aceitar header customizado, pode usar
   `x-invent-token: <segredo>` em vez da query — as duas formas são aceitas.
8. **Acompanhar.** Mande um texto, um áudio e uma mensagem com link pelo WhatsApp real e olhe a
   aba *Executions* do hotfix. Deixe o fluxo antigo ativo por alguns dias: o rollback é apontar a
   URL do webhook de volta para `ia-whatsappinvent`.

## Reproduzindo e testando as mudanças

O JSON é gerado por script, não editado à mão, e o código dos nodes tem testes:

```bash
node legacy/tools/gen-hotfix.mjs legacy/n8n-hotfix-mudanca-fiscal.json   # regenera
node legacy/tools/test-hotfix.mjs legacy/n8n-hotfix-mudanca-fiscal.json  # 31 testes
```

Os testes cobrem cada tipo de mensagem do WhatsApp, os filtros de segurança (token por header e
por query, allowlist de instância, `fromMe`, grupo, status, JID malformado, payload vazio), o
timezone e o normalizador de saída (URL preservada, negrito convertido, fallback de texto vazio).
Se você ajustar o código de um node no n8n, replique aqui e rode os testes.

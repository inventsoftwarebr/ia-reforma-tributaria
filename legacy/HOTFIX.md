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
5. **Configurar o Evolution** para chamar o webhook com o segredo. O caminho mais simples é
   acrescentar a query string na URL do webhook da instância:

   ```
   https://<seu-n8n>/webhook/ia-whatsappinvent?token=<segredo>
   ```

   Se sua versão do Evolution permitir headers customizados no webhook, prefira
   `x-invent-token: <segredo>` — as duas formas são aceitas.
6. **Testar com o workflow ainda desativado**, usando *Execute Workflow* e um payload real de
   webhook (pegue um da aba Executions do fluxo antigo). Confira: texto responde, áudio recebe o
   pedido de texto, mensagem de grupo não gera resposta, requisição sem token não passa.
7. **Virar a chave:** desative o workflow antigo e ative o hotfix. Mantenha o antigo por alguns
   dias como rollback.
8. **Verificar no WhatsApp real:** mande um texto, um áudio e um link pelo número de teste.

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

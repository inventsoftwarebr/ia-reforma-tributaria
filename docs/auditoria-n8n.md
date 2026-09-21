# Auditoria do fluxo n8n — "MUDANÇA FISCAL - Invent"

Fonte: `../legacy/n8n-mudanca-fiscal.json` (workflow id `EnHMeVrDmM3TEIPk`, tag `invent`, `active: false` no export).
Data da auditoria: 2026-09-21.

## 1. O que o fluxo faz hoje

```
Evolution API (WhatsApp)
  └─> Webhook3            POST /ia-whatsappinvent
      └─> Switch          separa fromMe=false ("usuario") / fromMe=true ("eu", desconectado)
          └─> Set         extrai Numero, instancia, mensagem, idmensagem, nome, leadGeral=true
              └─> Code    "verificageral": merge + timestamps (Europe/Lisbon)
                  └─> Router (AI Agent, LangChain v2)
                      ├─ LLM     Google Gemini (options: {} → default do node)
                      ├─ memória Redis chat, key chat_history:<remoteJid>, TTL 3d, janela 40
                      └─ tools   Google Docs (doc inteiro) · HTTP (contabeis.com.br) · Calculator · Date&Time (Lisbon)
                      └─> Code   "6.0 - Normalizar AI Agent Output"
                          └─> Evolution  envia texto para remoteJid
```

Produto: agente de WhatsApp que responde dúvidas sobre a Reforma Tributária e, em contexto
adequado, oferece o Simulador da Reforma Tributária da Invent
(`lp.inventsoftware.com.br/simulador-reforma-tributaria`, com UTM de campanha).

Dependências externas: Evolution API (VPS/EasyPanel), Redis, Google Gemini, Google Docs
(documento `1eAOFM9z_...`), site de terceiros `contabeis.com.br`. Todas amarradas a
credenciais por id no n8n — o export sozinho não reproduz o ambiente.

## 2. Achados

Severidade: **A** = corrigir antes de qualquer promoção do canal · **M** = corrigir na migração · **B** = melhoria.

### Segurança

| # | Sev | Achado |
|---|-----|--------|
| S1 | **A** | Webhook `POST /ia-whatsappinvent` sem autenticação, sem HMAC e sem allowlist de instância. Qualquer um que descubra a URL dispara o fluxo. |
| S2 | **A** | O destinatário do envio vem do corpo da requisição (`body.data.key.remoteJid` → `Numero` → node de envio). Um POST forjado faz a instância Evolution da Invent **enviar mensagem para qualquer número**. Vetor de spam com o número oficial, custo de LLM e risco concreto de ban do número no WhatsApp. |
| S3 | M | Node de envio com `instanceName: "="` (vazio) — a instância efetiva fica implícita na credencial. Trocar a credencial passa a enviar pela instância errada, sem erro visível. |
| S4 | **A** | Sem rate limit por número, por instância ou por janela de tempo. Um usuário (ou um script) gera custo de LLM ilimitado. |
| S5 | M | Dados pessoais (número, `pushName`, conteúdo das conversas) trafegam para Google (Gemini + Docs) e ficam em Redis por 3 dias sem registro de base legal, sem política e sem rotina de exclusão. |

### Correção / bugs

| # | Sev | Achado |
|---|-----|--------|
| B1 | **A** | O Set só lê `body.data.message.conversation`. Áudio (`audioMessage`), imagem, documento, resposta/citação e mensagens com link (`extendedTextMessage`), botões, listas e reações resultam em `mensagem: undefined` → o agente recebe prompt vazio e responde fora de contexto. É a causa mais provável dos relatos de "a IA respondeu estranho": no WhatsApp, áudio e mensagem citada são rotina. |
| B2 | B | O Code `verificageral` foi escrito para um Merge de dois ramos (`inputs[1]` = "planilha") que não existe neste fluxo. `planilha` é sempre `{}` — código morto herdado de outro workflow, junto com `leadGeral`, `sheet_data` e `action`. |
| B3 | **A** | Timezone `Europe/Lisbon` em dois pontos (`verificageral` e a tool Date & Time). Brasil fica 4-5h atrás: perto da virada do dia o bot informa a data errada. Em um agente cuja matéria é **cronograma e prazos**, isso produz resposta errada com aparência de certeza. Viola CLAUDE.md §8 (UTC no banco, render em `America/Sao_Paulo`). |
| B4 | **A** | No normalizador, o caminho `action_json` preenche `bot_response` mas o node de envio usa `$json.message` — que nesse caminho não existe. Resultado: mensagem vazia enviada ao cliente (ou erro do Evolution). |
| B5 | M | O normalizador usa regex gulosa `/{[\s\S]*}/` e depois `replace(/\/\/.*$/gm, '')`, que remove tudo após `//` — inclusive dentro de URLs. Como o fluxo **manda um link** como parte da estratégia, qualquer resposta em que o bloco JSON contenha uma URL é corrompida. |
| B6 | M | Sem filtro de JID: `@g.us` (grupos), `@broadcast` e `status@broadcast` entram no fluxo. O bot responde dentro de grupos, mensagem por mensagem. |
| B7 | M | Sem deduplicação por `data.key.id`. Evolution reentrega eventos em reconexão → resposta duplicada. Viola CLAUDE.md §6 (webhook sempre idempotente). |
| B8 | **A** | Sem debounce/agregação. Três mensagens seguidas = três execuções paralelas, três respostas sobrepostas e histórico Redis fora de ordem. Padrão dominante de uso no WhatsApp. |
| B9 | M | A saída `eu` (fromMe) do Switch está desconectada. Funciona como filtro, mas não existe pausa do bot quando um humano assume a conversa pelo mesmo número. |
| B10 | **A** | Nenhum tratamento de erro. Falha de Gemini, Redis, Google Docs ou do site de terceiros = silêncio total para quem perguntou. Sem retry, sem fila morta, sem mensagem de fallback, sem alerta. |

### Qualidade da resposta e risco jurídico

| # | Sev | Achado |
|---|-----|--------|
| Q1 | **A** | O system prompt instrui: *"Se a resposta exata não estiver nas tools, utilize sua base de conhecimento"*, *"Você deve sempre fornecer uma resposta"*, *"Nunca diga que não tem informação"*. É licença explícita para alucinar. Em alíquota, prazo, crédito e regime de transição, uma resposta inventada com a marca Invent é risco jurídico e reputacional — e é exatamente o oposto da regra de guard-rails do CLAUDE.md §10. |
| Q2 | **A** | Zero citações. Quem lê não distingue o que veio da LC 214/2025, de um blog ou do palpite do modelo. |
| Q3 | M | A tool `docs` baixa o Google Doc **inteiro** em cada chamada: latência e custo crescem com o documento, e quando o material crescer estoura a janela de contexto. Sem chunking, sem ranking, sem versionamento, sem controle de vigência. |
| Q4 | **A** | A tool `http` raspa HTML de `contabeis.com.br` como fonte: HTML bruto no contexto (desperdício), quebra a cada mudança de layout, conteúdo de terceiro sem controle editorial da Invent nem licença de uso, e tratado com o mesmo peso da lei. |
| Q5 | M | O prompt pede que o modelo mantenha um "marcador interno" `oferta_simulador_recentemente` e o resete após 6 mensagens. LLM não tem estado entre turnos: na prática a oferta do simulador ou se repete ou nunca acontece. Controle de oferta precisa de estado em banco. |
| Q6 | M | Gemini com `options: {}` — modelo, temperatura e limites no default do node. Sem versão fixada, sem reprodutibilidade, sem teto de custo. |
| Q7 | B | Sem `maxIterations` nem timeout no agente: um loop de tools roda longo e caro sem travar. |
| Q8 | B | O system prompt é um JSON serializado dentro de uma string — difícil de revisar, versionar e diffar. |

### Produto e operação

| # | Sev | Achado |
|---|-----|--------|
| P1 | **A** | Nenhum lead chega ao HubSpot, embora o canal seja declaradamente de marketing (`utm_source=ia+whatsapp+mkt`). `leadGeral: true` é setado e nunca usado. O ativo mais valioso do fluxo — a intenção de quem pergunta — é descartado. |
| P2 | **A** | Nenhuma conversa é persistida. Não há como medir volume, temas mais perguntados, taxa de aceite do simulador, taxa de erro, ou usar as perguntas reais para alimentar a base. |
| P3 | M | Sem handoff humano. O pico de intenção comercial é justamente quando a dúvida virou projeto, e ali a conversa morre. |
| P4 | **A** | LGPD: canal de marketing, dado pessoal tratado, sem consentimento registrado, sem opt-out ("sair"/"parar"), sem `/dados` e `/excluir`, sem disclosure de transferência internacional. CLAUDE.md §9 trata isso como não-opcional. |
| P5 | B | Link do simulador com UTM hardcoded no prompt: trocar campanha exige editar o prompt, e não há atribuição de conversão confiável. |
| P6 | M | Sem testes, sem staging e sem versionamento de prompt. Todo ajuste é feito em produção, no editor do n8n, sem rollback. |
| P7 | M | Sem observabilidade: latência, custo por conversa, taxa de refusal e taxa de erro são invisíveis. |
| P8 | B | Reprodutibilidade presa ao n8n: 4 credenciais por id e o material de conhecimento em um Google Doc pessoal. |

## 3. Leitura geral

O fluxo é um bom protótipo de validação: provou que existe demanda e que o WhatsApp é o canal
certo. O que ele não tem é o que separa protótipo de produto: **fonte de verdade controlada com
citação, idempotência, estado, captura de lead, LGPD e observabilidade**.

Dois achados merecem ação independente da migração, porque valem para o fluxo que está no ar
hoje: **S1+S2** (webhook aberto permitindo envio para número arbitrário) e **Q1** (prompt que
manda nunca admitir desconhecimento, em matéria tributária). Os dois se resolvem em minutos no
n8n — token no webhook e ajuste de duas linhas do prompt — e não precisam esperar a migração.

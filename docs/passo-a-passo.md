# Passo a passo do que depende de você

Ordem pensada para que cada parte entregue algo sozinha. A parte 1 melhora o bot que está no ar
**hoje** e não depende de nenhuma das outras.

| Parte | O que é | Tempo | Depende de |
| --- | --- | --- | --- |
| 1 | Hotfix no n8n | ~30 min | nada |
| 2 | Banco no Supabase | ~15 min | nada |
| 3 | Chave do modelo de IA | ~10 min | nada |
| 4 | Fila (QStash) | ~5 min | nada |
| 5 | Deploy na Vercel | ~20 min | partes 2, 3, 4 |
| 6 | Ligar o bot novo num número de teste | ~15 min | parte 5 |
| 7 | Roteiro de aceitação | ~20 min | parte 6 |
| 8 | Curadoria da base fiscal | contínuo | nada |
| 9 | Pipeline do HubSpot | ~10 min | nada |

Guarde tudo que for segredo num gerenciador de senhas. Nada de segredo em e-mail, WhatsApp ou
mensagem para mim.

---

## Parte 1 — Hotfix no n8n

Corrige, no fluxo que já está atendendo: webhook sem autenticação, áudio e mensagem citada
chegando vazios, timezone errado, mensagem vazia enviada ao cliente e o prompt que proíbe o
modelo de admitir desconhecimento.

### 1.1 Gerar o segredo do webhook

Escolha um caminho:

- **Mac ou Linux**, no terminal: `openssl rand -hex 32`
- **Windows**, no PowerShell:
  ```powershell
  -join ((1..64) | % { '{0:x}' -f (Get-Random -Max 16) })
  ```
- **Qualquer navegador**: F12 → Console →
  ```js
  crypto.randomUUID().replaceAll('-','') + crypto.randomUUID().replaceAll('-','')
  ```

Salve no gerenciador de senhas como *n8n hotfix — token do webhook*.

### 1.2 Backup do fluxo atual

No n8n, abra *MUDANÇA FISCAL - Invent* → menu `...` (canto superior direito) → **Download**.
Guarde o arquivo. É o seu plano B independente de tudo.

### 1.3 Importar o hotfix

Baixe `legacy/n8n-hotfix-mudanca-fiscal.json` do repositório (no GitHub, abra o arquivo e use
**Download raw file**).

No n8n: **Workflows** → **Add workflow** → menu `...` → **Import from File** → escolha o arquivo.
Ele entra como *MUDANÇA FISCAL - Invent (hotfix)*, desativado.

### 1.4 Reconectar as credenciais

Abra cada node com triângulo de aviso e selecione a credencial que já existe:

| Node | Credencial |
| --- | --- |
| `5 - Enviar Resposta` | Evolution account |
| `Redis Chat Memory` | Redis account |
| `Google Gemini Chat Model` | Google Gemini(PaLM) Api account |
| `Get a document in Google Docs` | Google Docs account |

### 1.5 Descobrir o nome exato da instância na Evolution

Pelo Evolution Manager (normalmente `https://<seu-evolution>/manager`), a instância aparece
nomeada na lista. Pela API:

```bash
curl -s "https://<seu-evolution>/instance/fetchInstances" -H "apikey: <APIKEY_GLOBAL>"
```

Copie o nome **exatamente** como está, maiúsculas e minúsculas incluídas.

### 1.6 Preencher o segredo e a instância

Abra o node `1 - Validar e Normalizar` e preencha as duas primeiras linhas:

```js
const EXPECTED_TOKEN = 'cole-o-segredo-aqui';
const ALLOWED_INSTANCES = ['nome-exato-da-instancia'];
```

Enquanto `EXPECTED_TOKEN` estiver vazio a checagem fica desligada — foi feito assim para a
importação não derrubar o bot antes de você configurar. Depois de preencher, **salve**.

### 1.7 Ativar e testar sem tocar na Evolution

O hotfix usa o path `ia-whatsappinvent-v2`, diferente do fluxo antigo, justamente para os dois
poderem ficar ativos ao mesmo tempo. Ative o hotfix (botão *Active*).

Teste chamando a URL de produção direto, **com o seu próprio número** no `remoteJid` — é para ele
que a resposta vai:

```bash
curl -X POST "https://<seu-n8n>/webhook/ia-whatsappinvent-v2?token=<segredo>" \
  -H 'content-type: application/json' \
  -d '{"instance":"<sua-instancia>","data":{
        "key":{"remoteJid":"5562SEUNUMERO@s.whatsapp.net","id":"TESTE-1","fromMe":false},
        "pushName":"Teste","message":{"conversation":"O que muda em 2026?"}}}'
```

Confira nesta ordem:

| Teste | Esperado |
| --- | --- |
| sem `?token=` | nada acontece, nenhuma execução com resposta |
| token errado | nada acontece |
| token certo | chega resposta no seu WhatsApp |
| `"message":{"audioMessage":{"seconds":5}}` | chega o pedido para escrever em texto |
| `remoteJid` terminando em `@g.us` | nada acontece |
| mesmo comando duas vezes | responde duas vezes (dedupe é do projeto novo, não do hotfix) |

### 1.8 Virar a chave

Na Evolution, troque a URL do webhook da instância para:

```
https://<seu-n8n>/webhook/ia-whatsappinvent-v2?token=<segredo>
```

Mantenha o evento `MESSAGES_UPSERT`. Pelo Manager: instância → *Webhook* (ou *Integrations*) →
cole a URL → salvar. Pela API (o formato varia entre versões; se recusar, use o Manager):

```bash
curl -X POST "https://<seu-evolution>/webhook/set/<instancia>" \
  -H "apikey: <APIKEY_GLOBAL>" -H 'content-type: application/json' \
  -d '{"webhook":{"enabled":true,
        "url":"https://<seu-n8n>/webhook/ia-whatsappinvent-v2?token=<segredo>",
        "events":["MESSAGES_UPSERT"]}}'
```

Depois mande um texto, um áudio e uma mensagem com link pelo WhatsApp real e acompanhe a aba
*Executions* do hotfix.

**Rollback:** aponte a URL do webhook de volta para `.../webhook/ia-whatsappinvent`. Deixe o fluxo
antigo ativo por alguns dias para isso ser instantâneo.

---

## Parte 2 — Banco no Supabase

### 2.1 Criar o projeto

[supabase.com](https://supabase.com) → **New project**.

- Nome: `ia-reforma-tributaria`
- Região: **South America (São Paulo)** se aparecer — reduz latência de cada query.
- **Database password**: gere uma forte e salve no gerenciador. Ela aparece uma vez.

### 2.2 Pegar as duas strings de conexão

No projeto, botão **Connect** (topo da página). Você precisa de duas:

| Onde | Porta | Vai virar |
| --- | --- | --- |
| **Transaction pooler** | 6543 | `DATABASE_URL` |
| **Direct connection** | 5432 | `DIRECT_URL` |

Em cada uma, troque `[YOUR-PASSWORD]` pela senha do passo 2.1.

Não inverta: a aplicação roda em serverless e precisa do pooler (6543). Com 5432 a Vercel esgota
conexões e começa a dar timeout.

### 2.3 Pegar as chaves da API

**Project Settings** → **API** (ou *API Keys*):

| Campo | Vai virar |
| --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` / publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` / secret key | `SUPABASE_SERVICE_ROLE_KEY` |

A `service_role` ignora todas as políticas de segurança do banco. Ela só existe em variável de
ambiente de servidor — nunca em código do navegador, nunca em repositório.

### 2.4 Criar as tabelas

No repositório, abra `db/bootstrap.sql` e use **Copy raw file**.

No Supabase: **SQL Editor** → **New query** → cole tudo → **Run**.

Esperado: sucesso, sem erro. Esse arquivo cria as 8 tabelas, liga a segurança de linha (RLS) em
todas, cria as políticas e já registra a migration, para que as próximas alterações de schema
funcionem normalmente por migration.

Se você rodar de novo por engano, ele aborta com *"Banco já inicializado"* em vez de estragar
nada.

### 2.5 Conferir

**Table Editor** deve listar: `contacts`, `conversations`, `messages`, `conversation_state`,
`ai_runs`, `usage_counters`, `job_failures`, `hubspot_outbox` — todas marcadas com RLS ativo.

---

## Parte 3 — Chave do modelo de IA

[console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create Key**.

- Nome: `ia-reforma-tributaria`
- Copie a chave (aparece uma vez) → vira `ANTHROPIC_API_KEY`
- Em **Billing**, coloque crédito. Sem crédito a chave existe mas toda chamada falha.

Deixe `AI_PROVIDER=anthropic` e `AI_MODEL=claude-sonnet-5`. Se preferir seguir com o Gemini que o
n8n já usa, é `AI_PROVIDER=google` + `GOOGLE_GENERATIVE_AI_API_KEY` — o código aceita os dois, e a
decisão pode esperar a fase 2, quando der para comparar com um conjunto de perguntas de teste.

---

## Parte 4 — Fila (QStash)

[upstash.com](https://upstash.com) → crie a conta → **QStash** no console.

Copie três valores da própria página do QStash:

| Valor | Variável |
| --- | --- |
| Token | `QSTASH_TOKEN` |
| Current Signing Key | `QSTASH_CURRENT_SIGNING_KEY` |
| Next Signing Key | `QSTASH_NEXT_SIGNING_KEY` |

O plano gratuito cobre folgado o volume de um bot em teste. A fila é o que faz três mensagens
seguidas virarem uma resposta só, em vez de três respostas atropeladas.

---

## Parte 5 — Deploy na Vercel

### 5.1 Importar o repositório

[vercel.com](https://vercel.com) → **Add New** → **Project** → **Import Git Repository** →
`inventsoftwarebr/ia-reforma-tributaria`.

Se o repositório não aparecer, é permissão do app do GitHub: em **Install GitHub App** /
*Configure*, dê acesso a ele. O framework é detectado como Next.js; não mexa em build command.

### 5.2 Variáveis de ambiente

Cole todas antes do primeiro deploy (**Environment Variables**). Marque *Production* e *Preview*.

| Variável | Valor |
| --- | --- |
| `APP_URL` | por enquanto `https://ia-reforma-tributaria.vercel.app` (ajustado em 5.4) |
| `DATABASE_URL` | pooler, porta **6543** (parte 2.2) |
| `DIRECT_URL` | direct, porta 5432 (parte 2.2) |
| `NEXT_PUBLIC_SUPABASE_URL` | parte 2.3 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | parte 2.3 |
| `SUPABASE_SERVICE_ROLE_KEY` | parte 2.3 |
| `WHATSAPP_GATEWAY` | `evolution` |
| `EVOLUTION_API_URL` | `https://<seu-evolution>` |
| `EVOLUTION_API_KEY` | a apikey global da Evolution |
| `EVOLUTION_INSTANCE` | nome da instância **de teste** (parte 6.1) |
| `EVOLUTION_WEBHOOK_SECRET` | **um segredo novo**, diferente do da parte 1 |
| `QSTASH_TOKEN` | parte 4 |
| `QSTASH_CURRENT_SIGNING_KEY` | parte 4 |
| `QSTASH_NEXT_SIGNING_KEY` | parte 4 |
| `TURN_DEBOUNCE_SECONDS` | `7` |
| `RATE_LIMIT_MESSAGES_PER_DAY` | `50` |
| `AI_PROVIDER` | `anthropic` |
| `AI_MODEL` | `claude-sonnet-5` |
| `ANTHROPIC_API_KEY` | parte 3 |
| `AI_MAX_TOKENS_PER_TURN` | `1200` |
| `SIMULATOR_URL` | `https://lp.inventsoftware.com.br/simulador-reforma-tributaria/` |
| `SIMULATOR_UTM` | `utm_source=ia+whatsapp+mkt&utm_campaign=simulador+da+reforma+tributaria` |

### 5.3 Deploy

**Deploy**. Se faltar variável obrigatória o build falha com a lista do que está faltando — é de
propósito, melhor falhar no deploy do que em cima do cliente.

### 5.4 Ajustar o `APP_URL`

Copie a URL real do projeto e, se for diferente do que você pôs em 5.2, corrija `APP_URL` e faça
**Redeploy**. Essa variável é o endereço que a fila chama de volta; errada, nenhuma resposta sai.

### 5.5 Conferir

Abra `https://<sua-url>/` — deve aparecer a página de status. E:

```bash
curl -i -X POST "https://<sua-url>/api/whatsapp/inbound"
```

Esperado: **401**. Sem o segredo, nada entra.

---

## Parte 6 — Ligar o bot novo num número de teste

Use um número que **não** seja o do atendimento em produção. O bot novo e o hotfix atendem números
diferentes e podem conviver semanas.

### 6.1 Criar a instância de teste na Evolution

Pelo Manager: **Create instance** → nome, por exemplo `invent-teste` → conectar lendo o QR code no
celular do número de teste. Esse nome vai em `EVOLUTION_INSTANCE` (parte 5.2) — se você criou a
instância depois do deploy, corrija a variável e faça redeploy.

### 6.2 Apontar o webhook dessa instância para a Vercel

```
https://<sua-url>/api/whatsapp/inbound?token=<EVOLUTION_WEBHOOK_SECRET>
```

Evento: `MESSAGES_UPSERT`.

### 6.3 Primeiro teste real

Mande pelo WhatsApp, do seu celular para o número de teste: *"O que é a CBS?"*

Depois confira no Supabase → **Table Editor**:

- `contacts`: uma linha com o seu número
- `messages`: uma linha `inbound` e uma ou mais `outbound`
- `ai_runs`: uma linha com modelo, tokens e latência

Se não respondeu, `docs/runbook.md` tem a sequência de diagnóstico na seção *Investigar "o bot não
respondeu"*.

---

## Parte 7 — Roteiro de aceitação

Cada linha é um comportamento que o fluxo antigo errava. Rode tudo antes de pensar em apontar o
número de produção para cá.

| Teste | Esperado |
| --- | --- |
| "O que é a CBS?" | resposta clara, em blocos curtos, com negrito de um asterisco |
| três mensagens seguidas, rápido | **uma** resposta, considerando as três |
| mandar a mesma pergunta de novo | responde de novo (normal); reentrega do provider é que não duplica |
| áudio | pede para escrever em texto |
| foto sem legenda | pede para escrever em texto |
| foto com legenda perguntando algo | responde a legenda |
| mensagem citando outra | responde normalmente (o fluxo antigo recebia vazio) |
| adicionar o bot num grupo e falar lá | não responde |
| "qual vai ser a alíquota do IBS no meu caso?" | ou cita a norma, ou recusa e oferece especialista — **nunca** inventa número |
| "quanto é 2+2?" | recusa e reancora na Reforma Tributária |
| "quero falar com um consultor" | confirma o encaminhamento e **para de responder** naquela conversa |
| "sair" | confirma o descadastro e para |
| perguntar sobre impacto financeiro | oferece o simulador **perguntando antes**; só manda o link depois do "sim" |
| pedir o simulador duas vezes | não repete a oferta |

Anote o que sair diferente e me manda — cada divergência é um ajuste de prompt ou de guard-rail.

---

## Parte 8 — Curadoria da base fiscal

Isto é o que separa "bot que responde" de "bot que a Invent assina". Precisa de dono no time
fiscal e de revisão periódica.

### 8.1 Revisar o cronograma que está no código

`lib/tax/schedule.ts` é a **única** fonte de número do agente. Hoje está com
`REVISAO_PENDENTE = true`, e por isso toda resposta com número sai com aviso de conteúdo não
homologado.

O que eu preciso de volta: para cada ano (2023, 2025, 2026, 2027, 2029, 2033), a confirmação ou a
correção de **resumo**, **alíquotas/frações** e **norma de origem** — e os anos que faltam. Uma
planilha ou um e-mail com as linhas revisadas resolve. Com isso eu ajusto o arquivo e zero a
flag.

### 8.2 Entregar o corpus

Para cada documento, o arquivo (PDF, DOCX ou texto) e estes metadados:

| Campo | Exemplo |
| --- | --- |
| título | LC 214/2025 |
| tipo | lei, emenda, instrução normativa, nota técnica, FAQ, material Invent |
| autoridade | oficial, invent, secundária |
| url | link da fonte oficial |
| vigência início | 16/01/2025 |
| vigência fim | em branco se vigente |
| versão | consolidada até dd/mm/aaaa |

Sugestão de primeiro lote: EC 132/2023, LC 214/2025 com as alterações vigentes, o cronograma
consolidado, o FAQ que a Invent já usa, o conteúdo do Simulador e as notas do TaxPlus e do Comex.

Imprensa especializada entra como **secundária**: serve de contexto, nunca é apresentada como
norma.

### 8.3 Combinar a revisão

Defina de quanto em quanto tempo a base é revisada (sugestão: mensal até 2027, dado o ritmo de
regulamentação) e quem assina. O sistema vai avisar quando uma fonte passar da vigência.

---

## Parte 9 — Pipeline do HubSpot

Para a fase 3 (lead e handoff), preciso saber:

1. **Portal ID** da conta.
2. **Pipeline e etapa** que recebem o lead vindo do WhatsApp.
3. Se o lead entra como **contato**, **negócio** ou os dois.
4. **Owner** padrão, ou a regra de distribuição.
5. Quais propriedades preencher (origem, tema perguntado, aceitou o simulador, segmento, ERP).
6. Um **private app token** com escopo de escrita em contatos e negócios — esse valor vai direto
   na Vercel, não para mim.

---

## Apêndice — três respostas que eu ainda preciso

**O Google Doc `1eAOFM9z...` é a base atual e atualizada?** É o ponto de partida da ingestão da
fase 2. Se existir material mais novo em outro lugar, me diga onde.

**Qual a versão da Evolution API?** O rodapé do Manager mostra, ou:
```bash
curl -s https://<seu-evolution>/ | head -c 300
```
Se aceitar header customizado no webhook, prefira `x-invent-token` à query string.

**O número de produção é oficial da Invent ou um chip avulso?** Se foi conectado por QR code num
celular comum, é chip avulso — e aí o risco de bloqueio pesa mais, o que antecipa a conversa sobre
migrar para a API oficial da Meta.

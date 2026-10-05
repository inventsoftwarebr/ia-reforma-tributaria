# Setup

Ordem pensada para cada parte entregar algo sozinha. Guarde todo segredo num gerenciador de
senhas — nada em e-mail ou WhatsApp.

| Parte | O que é | Tempo |
| --- | --- | --- |
| 1 | Banco no Supabase | ~15 min |
| 2 | Chaves de IA | ~10 min |
| 3 | Fila (QStash) | ~5 min |
| 4 | Deploy na Vercel | ~20 min |
| 5 | Instância do WhatsApp | ~15 min |
| 6 | Acesso ao console | ~5 min |
| 7 | Base de conhecimento | contínuo |
| 8 | HubSpot | ~10 min |

## 1. Banco no Supabase

1. [supabase.com](https://supabase.com) → **New project**. Região **South America (São Paulo)**
   se aparecer. Guarde a senha do banco: ela aparece uma vez.
2. Botão **Connect** no topo do projeto. Você precisa de duas strings:

   | Onde | Porta | Variável |
   | --- | --- | --- |
   | Transaction pooler | 6543 | `DATABASE_URL` |
   | Session pooler | 5432 | `DIRECT_URL` |

   Troque `[YOUR-PASSWORD]` pela senha. Não inverta: a aplicação roda em serverless e precisa do
   pooler em transaction mode; com 5432 a Vercel esgota conexões. Para o `DIRECT_URL`, use o
   *Session pooler* e não a *Direct connection*: esta pode funcionar só em IPv6 e falhar na sua
   rede. O `DIRECT_URL` só é usado por migration e scripts — a Vercel não precisa dele.
3. **Project Settings → API Keys**: a URL do projeto → `NEXT_PUBLIC_SUPABASE_URL`, e a
   **Publishable key** (`sb_publishable_...`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Em projeto
   antigo sem ela, use a `anon` da aba *Legacy*. A **secret key** (`sb_secret_...` /
   `service_role`) **não é usada**: não copie para lugar nenhum.
4. **SQL Editor → New query** → cole o conteúdo de `db/bootstrap.sql` (no GitHub, **Copy raw
   file**) → **Run**. Isso cria as 12 tabelas, o pgvector, os índices, a função de busca e as
   políticas de segurança, e já registra a migration. Rodar de novo por engano aborta com
   "Banco já inicializado" em vez de estragar algo.
5. **Conferir:** nova query com o conteúdo de `scripts/check-supabase.sql` → **Run**. São 9
   linhas, e todas devem sair com `ok = sim`. Qualquer `NÃO` diz exatamente o que faltou.

## 2. Chaves de IA

São duas coisas diferentes:

- **Conversa**: [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key →
  `ANTHROPIC_API_KEY`. Coloque crédito em Billing. `AI_PROVIDER=anthropic`,
  `AI_MODEL=claude-sonnet-5`.
- **Embeddings** (busca na base): [platform.openai.com](https://platform.openai.com) → API keys →
  `OPENAI_API_KEY`. `AI_EMBEDDING_MODEL=text-embedding-3-small`.

Sem a chave de embeddings a busca na base não funciona e o agente recusa tudo. Trocar o modelo de
embedding depois exige migration e reingestão — decida agora e não mexa.

## 3. Fila (QStash)

[upstash.com](https://upstash.com) → console → **QStash**. Copie da própria página:
`QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`.

É a fila que faz três mensagens seguidas virarem **uma** resposta, em vez de três atropeladas.

## 4. Deploy na Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → importe o repositório. Se ele não
   aparecer, dê acesso ao app do GitHub em *Configure*.
2. Cole as variáveis de ambiente (Production e Preview) antes do primeiro deploy. Use
   `.env.example` como lista. Gere os dois segredos com `openssl rand -hex 32`:
   `EVOLUTION_WEBHOOK_SECRET` e `CRON_SECRET`.
3. **Deploy**. Faltando variável obrigatória o build falha com a lista do que falta — de
   propósito.
4. Copie a URL real do projeto, corrija `APP_URL` e faça **Redeploy**. Essa variável é o endereço
   que a fila chama de volta; errada, nenhuma resposta sai.
5. Conferir: `curl -i -X POST https://<sua-url>/api/whatsapp/inbound` deve responder **401**.

O cron do outbox já vai configurado em `vercel.json` (a cada 10 minutos).

## 5. Instância do WhatsApp

Comece por um **número de teste**, não pelo número de atendimento.

1. No Evolution Manager (normalmente `https://<seu-evolution>/manager`), **Create instance**,
   nome por exemplo `invent-teste`, e conecte lendo o QR code no celular do número de teste.
2. Esse nome vai em `EVOLUTION_INSTANCE`. `EVOLUTION_API_URL` é a URL da Evolution e
   `EVOLUTION_API_KEY` é a apikey global. Para descobrir o nome exato de uma instância existente:

   ```bash
   curl -s "https://<seu-evolution>/instance/fetchInstances" -H "apikey: <APIKEY_GLOBAL>"
   ```
3. Aponte o webhook da instância para:

   ```
   https://<sua-url>/api/whatsapp/inbound?token=<EVOLUTION_WEBHOOK_SECRET>
   ```

   Evento: `MESSAGES_UPSERT`. Se sua versão aceitar header customizado, pode usar
   `x-invent-token: <segredo>` — as duas formas são aceitas.
4. Mande *"O que é a CBS?"* do seu celular para o número de teste e confira no Supabase:
   `contacts` com seu número, `messages` com entrada e saída, `ai_runs` com uma linha.

## 6. Acesso ao console

O console não tem cadastro aberto: usuários são criados por você.

1. Supabase → **Authentication → Users → Add user** → e-mail e senha.
2. A trigger cria o perfil com papel `agent` (lê tudo, assume conversa). Para promover a `admin`
   (curadoria da base e do prompt), rode no SQL Editor:

   ```sql
   update profiles set role = 'admin' where email = 'voce@inventsoftware.com.br';
   ```
3. Entre em `https://<sua-url>/entrar`.

## 7. Base de conhecimento

Sem base, o agente recusa qualquer pergunta que dependa de norma — correto, mas não atende
ninguém. O passo a passo está em [`kb/README.md`](../kb/README.md). Em resumo: converta o
documento para Markdown, descreva em `kb/manifest.json` e rode `pnpm kb:ingest`.

Dois pedidos ao time fiscal:

- revisar `lib/tax/schedule.ts` linha por linha e liberar `REVISAO_PENDENTE = false`;
- definir quem cura a base e de quanto em quanto tempo é revisada.

## 8. HubSpot

Opcional para começar: sem token, o lead fica acumulado em `hubspot_outbox` e o console avisa —
nada é perdido.

Quando for ligar: private app com escopo de escrita em contatos e negócios →
`HUBSPOT_PRIVATE_APP_TOKEN`; e o id do pipeline e da etapa de destino →
`HUBSPOT_PIPELINE_ID`, `HUBSPOT_DEAL_STAGE_ID`.

## Roteiro de aceitação

Antes de apontar o número de produção, rode isto no número de teste:

| Teste | Esperado |
| --- | --- |
| "O que é a CBS?" | resposta curta, citando a fonte |
| três mensagens seguidas, rápido | **uma** resposta considerando as três |
| áudio | pede para escrever em texto |
| foto com legenda perguntando algo | responde a legenda |
| mensagem citando outra | responde normalmente |
| falar num grupo com o bot | não responde |
| "qual a alíquota no meu caso?" | cita a norma ou recusa e oferece especialista |
| "quanto é 2+2?" | recusa e reancora na Reforma Tributária |
| "quero falar com um consultor" | confirma e **para de responder** naquela conversa |
| "sair" | confirma o descadastro e para |
| pergunta sobre impacto financeiro | oferece o simulador **perguntando antes** |
| pedir o simulador duas vezes | não repete a oferta |

Divergência aqui é ajuste de prompt ou de guard-rail — anote e traga.

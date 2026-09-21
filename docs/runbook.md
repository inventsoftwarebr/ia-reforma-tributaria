# Runbook

## Rodar local

```bash
pnpm install
cp .env.example .env.local   # preencha DATABASE_URL (6543), DIRECT_URL (5432) e o resto
pnpm db:migrate              # aplica migrations
pnpm db:rls                  # aplica políticas RLS (rodar depois de toda migration)
pnpm dev
```

Sem `QSTASH_TOKEN` o turno roda inline na própria requisição do webhook — bom para
desenvolvimento, inaceitável em produção.

Para exercitar o webhook sem WhatsApp:

```bash
curl -X POST "http://localhost:3000/api/whatsapp/inbound?token=$EVOLUTION_WEBHOOK_SECRET" \
  -H 'content-type: application/json' \
  -d '{"event":"messages.upsert","instance":"'"$EVOLUTION_INSTANCE"'","data":{
        "key":{"remoteJid":"5562999998888@s.whatsapp.net","id":"TESTE-1","fromMe":false},
        "pushName":"Teste","message":{"conversation":"O que muda em 2026?"}}}'
```

Repetir o mesmo comando deve responder `{"ok":true,"ignored":"duplicate"}` — é a idempotência
funcionando.

## Verificar antes de commitar

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Configurar o webhook na Evolution

Aponte a instância para `https://<app>/api/whatsapp/inbound?token=<EVOLUTION_WEBHOOK_SECRET>`.
Se a sua versão aceitar header customizado, prefira `x-invent-token: <segredo>` — as duas formas
são aceitas. O segredo tem no mínimo 16 caracteres: `openssl rand -hex 32`.

Sem o segredo correto a requisição recebe 401 e nada acontece: é o que impede que um POST forjado
faça a instância da Invent enviar mensagem para um número arbitrário.

## Girar o segredo do webhook

1. Gere o novo segredo e configure na Evolution (a instância passa a mandar o novo token).
2. Atualize `EVOLUTION_WEBHOOK_SECRET` na Vercel e faça deploy.

Há uma janela de segundos em que mensagens são rejeitadas com 401. Faça fora do horário comercial
ou aceite a perda — a pessoa reenvia.

## Pausar o bot em uma conversa

```sql
update conversations set status = 'handoff' where id = '<conversation_id>';
```

O worker consome o pendente e não responde mais. Para religar, volte o status para `active`.

## Pausar o bot inteiro

Desligue o webhook na Evolution, ou remova `EVOLUTION_WEBHOOK_SECRET` do ambiente (tudo passa a
receber 401). Não deixe o webhook apontando para um endpoint morto por muito tempo: a Evolution
acumula retentativas.

## Reprocessar turnos que falharam

Falha de turno grava em `job_failures` com os ids das mensagens envolvidas e já manda a mensagem
de fallback ao usuário — então reprocessar é opcional e serve para investigação:

```sql
select id, error, payload, created_at from job_failures
 where kind = 'turn' and resolved_at is null
 order by created_at desc;
```

Para forçar um novo turno na conversa, limpe o `processed_at` das mensagens citadas no payload e
publique o job novamente:

```sql
update messages set processed_at = null where id = any('{<uuid>,<uuid>}'::uuid[]);
```

Depois marque `resolved_at = now()` na linha de `job_failures`.

## Investigar "o bot não respondeu"

Na ordem:

1. `select * from messages where provider_message_id = '<id>'` — chegou? Se não, o webhook
   rejeitou: veja o log por `whatsapp.inbound.discarded` (motivo) ou `invalid_token`.
2. Chegou e `processed_at` é null → a fila não disparou. Confira o QStash.
3. `processed_at` preenchido e nenhuma mensagem `outbound` → veja `job_failures` e o log
   `turn.failed` / `turn.send_failed`.
4. Tem `outbound` com `status = 'failed'` → a Evolution recusou o envio; confira a instância.
5. `ai_runs.refused = true` → o guard-rail bloqueou a resposta (número sem respaldo). Não é bug:
   é lacuna da base de conhecimento. Anote o tema para a curadoria.

## LGPD — pedido de exclusão

```sql
-- apaga conteúdo mantendo a métrica agregada
select public.anonymize_old_messages(interval '0 second');  -- cuidado: atinge tudo
```

Para um contato específico, prefira `delete from contacts where phone_e164 = '+55...'` — o cascade
remove conversas, mensagens e contadores. Registre o atendimento do pedido fora do sistema.

## Custo e volume

```sql
select date_trunc('day', created_at) as dia,
       count(*) as respostas,
       sum(input_tokens + output_tokens) as tokens,
       round(avg(latency_ms)) as latencia_media,
       sum(case when refused then 1 else 0 end) as recusas
  from ai_runs group by 1 order by 1 desc limit 14;
```

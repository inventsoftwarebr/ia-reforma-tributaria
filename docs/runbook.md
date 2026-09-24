# Runbook

## Rodar local

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate && pnpm db:sql   # ou cole db/bootstrap.sql no SQL Editor
pnpm kb:ingest
pnpm dev
```

Sem `QSTASH_TOKEN` o turno roda inline na própria requisição do webhook: bom para desenvolvimento,
inaceitável em produção.

Exercitar o webhook sem WhatsApp:

```bash
curl -X POST "http://localhost:3000/api/whatsapp/inbound?token=$EVOLUTION_WEBHOOK_SECRET" \
  -H 'content-type: application/json' \
  -d '{"event":"messages.upsert","instance":"'"$EVOLUTION_INSTANCE"'","data":{
        "key":{"remoteJid":"5562999998888@s.whatsapp.net","id":"TESTE-1","fromMe":false},
        "pushName":"Teste","message":{"conversation":"O que muda em 2026?"}}}'
```

Repetir o mesmo comando deve devolver `{"ok":true,"ignored":"duplicate"}` — é a idempotência
funcionando.

## Verificar antes de commitar

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Pausar o bot

- **Numa conversa:** console → conversa → *Assumir e pausar o bot*. O worker consome o pendente e
  fica calado até você devolver.
- **No canal inteiro:** desligue o webhook na Evolution, ou troque
  `EVOLUTION_WEBHOOK_SECRET` na Vercel (tudo passa a receber 401). Não deixe o webhook apontando
  para endpoint morto por muito tempo: a Evolution acumula retentativas.

## Girar o segredo do webhook

1. Gere o novo (`openssl rand -hex 32`) e configure na Evolution.
2. Atualize `EVOLUTION_WEBHOOK_SECRET` na Vercel e faça deploy.

Há uma janela de segundos em que mensagens recebem 401. Faça fora do horário comercial.

## Investigar "o bot não respondeu"

Na ordem:

1. `select * from messages where provider_message_id = '<id>'` — chegou? Se não, o webhook
   rejeitou: procure no log `whatsapp.inbound.discarded` (com o motivo) ou `invalid_token`.
2. Chegou e `processed_at` nulo → a fila não disparou. Confira o QStash e `APP_URL`.
3. `processed_at` preenchido e nenhuma mensagem de saída → veja `job_failures` e o log
   `turn.failed` / `turn.send_failed`.
4. Saída com `status = 'failed'` → a Evolution recusou o envio; confira a instância.
5. `ai_runs.refused = true` → o guard-rail bloqueou. **Não é bug.** Veja `refusal_reason`:

   | Motivo | O que significa | O que fazer |
   | --- | --- | --- |
   | `numeric_claim_without_support` | o modelo deu número sem base | falta fonte na base sobre o tema |
   | `fabricated_citation` | citou norma que não foi recuperada | idem; se recorrente, revise a política do prompt |
   | `empty_answer` | o modelo não produziu texto | veja `error` e a latência |

## "O agente recusa tudo"

Quase sempre base vazia ou vigência errada. Confira no console (`/admin/base`) e:

```sql
select count(*) from kb_chunks;
select slug, effective_from, effective_to, status from kb_sources order by title;
```

Fonte com `effective_to` no passado sai do retrieval por desenho.

## Reprocessar turno que falhou

A falha já mandou a mensagem de fallback ao usuário, então reprocessar é para investigação:

```sql
select id, error, payload, created_at from job_failures
 where kind = 'turn' and resolved_at is null order by created_at desc;
```

Para forçar um novo turno, limpe o `processed_at` das mensagens citadas no payload e mande a
mensagem de novo pelo WhatsApp (ou republique o job):

```sql
update messages set processed_at = null where id = any('{<uuid>,<uuid>}'::uuid[]);
```

Depois marque `resolved_at = now()` na linha de `job_failures`.

## HubSpot acumulando

```sql
select status, count(*) from hubspot_outbox group by status;
select id, event_type, attempts, last_error from hubspot_outbox
 where status <> 'sent' order by created_at desc limit 20;
```

`status = 'failed'` é tentativa esgotada (5x). Corrigido o motivo, volte para a fila:

```sql
update hubspot_outbox set status = 'pending', attempts = 0 where id = '<uuid>';
```

Forçar a drenagem: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/outbox`.

## Custo e volume

```sql
select date_trunc('day', created_at) as dia,
       count(*) as respostas,
       sum(case when refused then 1 else 0 end) as recusas,
       sum(input_tokens + output_tokens) as tokens,
       round(avg(latency_ms)) as latencia_media_ms
  from ai_runs group by 1 order by 1 desc limit 14;
```

Temas que mais geram recusa (o que a curadoria deve atacar primeiro):

```sql
select refusal_reason, count(*) from ai_runs
 where refused and created_at > now() - interval '30 days'
 group by 1 order by 2 desc;
```

## Atualizar a base

```bash
pnpm kb:ingest                      # só o que mudou (checksum)
pnpm kb:ingest -- --only=lc-214-2025
pnpm kb:ingest -- --force           # reprocessa tudo; gasta embedding
```

Norma revogada: em vez de apagar, preencha `effective_to` no manifesto e reingira. O histórico de
qual trecho sustentou cada resposta continua íntegro.

## LGPD

Pedido de exclusão de um contato:

```sql
delete from contacts where phone_e164 = '+55...';
```

O cascade remove conversas, mensagens e contadores. Registre o atendimento do pedido fora do
sistema.

Retenção geral (anonimiza conteúdo, preserva métrica):

```sql
select public.anonymize_old_messages(interval '12 months');
```

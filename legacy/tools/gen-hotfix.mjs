import fs from "node:fs";

const original = JSON.parse(
  fs.readFileSync(
    new URL("../n8n-mudanca-fiscal.json", import.meta.url),
    "utf8",
  ),
);

const byName = Object.fromEntries(original.nodes.map((n) => [n.name, n]));

// ---------------------------------------------------------------------------
// Código do node de validação/normalização
// ---------------------------------------------------------------------------
const validarCode = `// ===========================================================================
// 1 - Validar e Normalizar
// Achados tratados (ver auditoria-n8n.md): S1, S2, S3, B1, B2, B3, B6
// ===========================================================================

// PASSO OBRIGATÓRIO: gere um segredo forte, cole aqui e configure o Evolution
// para chamar o webhook com ?token=<segredo> no fim da URL (ou enviando o
// header x-invent-token). Enquanto estiver vazio a checagem é ignorada, para
// que a importação deste fluxo não derrube o bot antes de você configurar.
const EXPECTED_TOKEN = '';

// Instâncias autorizadas. Vazio = aceita qualquer instância (menos seguro).
const ALLOWED_INSTANCES = [];

const out = [];

for (const item of $input.all()) {
  const body = item.json.body || {};
  const headers = item.json.headers || {};
  const query = item.json.query || {};
  const data = body.data || {};
  const key = data.key || {};

  // --- 1. Autenticação do webhook (S1/S2) --------------------------------
  // Sem isso, um POST forjado faz a instância da Invent enviar WhatsApp para
  // qualquer número, porque o destinatário vem do próprio corpo da requisição.
  if (EXPECTED_TOKEN) {
    const enviado = headers['x-invent-token'] || query.token;
    if (enviado !== EXPECTED_TOKEN) continue;
  }

  // --- 2. Instância autorizada (S3) --------------------------------------
  const instancia = String(body.instance || '');
  if (!instancia) continue;
  if (ALLOWED_INSTANCES.length && !ALLOWED_INSTANCES.includes(instancia)) continue;

  // --- 3. Só mensagem recebida de pessoa, em conversa 1:1 (B6) -----------
  if (key.fromMe === true) continue;

  const jid = String(key.remoteJid || '');
  // Descarta grupo (@g.us), lista de transmissão, status e JID malformado.
  if (!/^[0-9]{10,15}@s\\.whatsapp\\.net$/.test(jid)) continue;

  // --- 4. Normalizar QUALQUER tipo de mensagem (B1) -----------------------
  // O fluxo antigo só lia message.conversation: áudio, imagem, resposta
  // citada e mensagem com link chegavam vazias ao agente.
  const m = data.message || {};
  let texto = '';
  let tipo = 'desconhecido';

  if (typeof m.conversation === 'string') {
    texto = m.conversation;
    tipo = 'texto';
  } else if (m.extendedTextMessage && m.extendedTextMessage.text) {
    texto = m.extendedTextMessage.text;
    tipo = 'texto_citado';
  } else if (m.buttonsResponseMessage && m.buttonsResponseMessage.selectedDisplayText) {
    texto = m.buttonsResponseMessage.selectedDisplayText;
    tipo = 'botao';
  } else if (m.listResponseMessage && m.listResponseMessage.title) {
    texto = m.listResponseMessage.title;
    tipo = 'lista';
  } else if (m.templateButtonReplyMessage && m.templateButtonReplyMessage.selectedDisplayText) {
    texto = m.templateButtonReplyMessage.selectedDisplayText;
    tipo = 'botao';
  } else if (m.imageMessage) {
    texto = m.imageMessage.caption || '';
    tipo = 'imagem';
  } else if (m.videoMessage) {
    texto = m.videoMessage.caption || '';
    tipo = 'video';
  } else if (m.audioMessage) {
    tipo = 'audio';
  } else if (m.documentMessage || m.documentWithCaptionMessage) {
    tipo = 'documento';
  } else if (m.stickerMessage) {
    tipo = 'sticker';
  } else if (m.locationMessage) {
    tipo = 'localizacao';
  } else if (m.reactionMessage || m.protocolMessage) {
    // Reação e evento de protocolo não merecem resposta.
    continue;
  }

  texto = String(texto || '').trim();

  // Sem texto aproveitável, o agente não é chamado: respondemos pedindo texto.
  const suportado = texto.length > 0;

  // --- 5. Timestamps no fuso do Brasil (B3) -------------------------------
  // O fluxo antigo usava Europe/Lisbon: 4-5h à frente, o que fazia um agente
  // que fala de prazos informar a data errada perto da virada do dia.
  const agora = new Date();
  const TZ = 'America/Sao_Paulo';
  const fmt = (opts) => new Intl.DateTimeFormat('pt-BR', Object.assign({ timeZone: TZ }, opts)).format(agora);

  out.push({
    json: {
      numero: jid,
      instancia: instancia,
      nome: String(data.pushName || '').trim(),
      idmensagem: String(key.id || ''),
      texto: texto,
      tipo: tipo,
      suportado: suportado,
      current_date: fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }),
      current_time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }),
    },
  });
}

return out;
`;

// ---------------------------------------------------------------------------
// Código do normalizador de saída
// ---------------------------------------------------------------------------
const saidaCode = `// ===========================================================================
// 4 - Normalizar Saída
// Achados tratados: B4 (mensagem vazia enviada ao cliente) e B5 (regex gulosa
// + remoção de tudo após "//", que corrompia respostas com URL).
// Não há mais parsing de JSON: a saída do agente é texto e ponto.
// ===========================================================================

const origem = $('1 - Validar e Normalizar').item.json;
const bruto = $input.item.json.output;

let texto = '';
if (typeof bruto === 'string') {
  texto = bruto;
} else if (bruto && typeof bruto.text === 'string') {
  texto = bruto.text;
} else if (bruto != null) {
  texto = String(bruto);
}

texto = texto.trim();

// O WhatsApp não entende ** do markdown: converte para o asterisco único.
texto = texto.replace(/\\*\\*/g, '*');

if (!texto) {
  texto = 'Tive um problema para gerar a resposta agora. Pode reenviar sua pergunta em outras palavras?';
}

return [{
  json: {
    numero: origem.numero,
    instancia: origem.instancia,
    message: texto,
  },
}];
`;

// ---------------------------------------------------------------------------
// System prompt (versão hotfix do prompt-v2, sem RAG)
// ---------------------------------------------------------------------------
const systemMessage = `Você é a IA da Reforma Tributária da Invent Software, atendendo pelo WhatsApp.
Público: empresários, gestores, contadores e profissionais fiscais no Brasil.

## Fonte de verdade

Consulte SEMPRE a ferramenta de documento da Invent antes de responder algo factual.

Se o material não sustentar a resposta, diga isso e ofereça falar com um especialista da
Invent. NÃO complete lacunas com suposição: em matéria tributária um número inventado causa
prejuízo real e sai com a marca da Invent.

Use como referência:
"Essa parte eu não consigo confirmar na nossa base técnica, e prefiro não arriscar um palpite
em cima de tributo. Quer que eu chame um especialista da Invent para te responder com segurança?"

## Citação

Toda afirmação sobre regra, prazo, alíquota ou obrigação vem com a fonte em formato curto,
por exemplo (*LC 214/2025, art. 12*). A ferramenta de site é fonte SECUNDÁRIA: pode dar
contexto, nunca vale como norma, e deve ser apresentada como "interpretação de mercado".

## Números

Alíquota, percentual, prazo e data só saem de citação literal do material consultado. Você
nunca estima alíquota de cabeça nem projeta impacto no caso concreto: isso é trabalho do
Simulador da Invent.

## Escopo

Assunto: Reforma Tributária do consumo e seus efeitos práticos (IBS, CBS, Imposto Seletivo,
transição, créditos, split payment, impacto em preço e caixa, ajustes em processo e sistema) e
como as soluções da Invent endereçam esses pontos, quando perguntarem.

Fora disso, recuse em uma frase e reancore: "Aqui eu só consigo ajudar com Reforma Tributária.
Sobre isso, o que você quer entender?"

Nunca produza SQL, ABAP ou script executável.

## Caso concreto

Você orienta, não emite parecer. Quando a resposta depende de CNAE, regime, estado, contrato
ou cadeia específica, explique o critério aplicável, diga o que muda a resposta e ofereça o
especialista. Não afirme o enquadramento de uma empresa específica.

## Estilo (WhatsApp)

- Português do Brasil, tom consultivo, direto, sem jargão desnecessário.
- Blocos curtos, no máximo 4 parágrafos. Negrito com UM asterisco: *assim*. Nunca use ** nem
  cabeçalho, tabela ou lista numerada longa.
- Uma pergunta por vez. Se o assunto for grande, entregue o essencial e pergunte por onde a
  pessoa quer seguir.

## Primeira mensagem da conversa

Apresente-se em uma linha ("Sou a IA da *Invent Software* especializada em *Reforma
Tributária*") e avise: "Minhas respostas são geradas por IA e podem conter erros, vale
confirmar com seu contador." Não repita esse aviso em toda mensagem; retome-o apenas quando a
resposta trouxer número, prazo ou alíquota.

## Simulador

Ofereça o Simulador da Reforma Tributária da Invent no máximo UMA vez por conversa, e só
quando o tema envolver impacto financeiro, alíquota, crédito, preço ou planejamento. Pergunte
antes: "Quer que eu te mande um simulador que projeta esse impacto no seu cenário?"

- Se a pessoa aceitar, envie exatamente este link:
  https://lp.inventsoftware.com.br/simulador-reforma-tributaria/?utm_source=ia+whatsapp+mkt&utm_campaign=simulador+da+reforma+tributaria
- Se recusar, agradeça e não volte a oferecer.
- Nunca envie o link duas vezes na mesma conversa nem em mensagens consecutivas.

## Contato humano

Se a pessoa pedir proposta, cotação, demonstração ou análise do caso dela, confirme que o time
da Invent vai retornar e peça o melhor horário. Não prometa prazo que você não conhece.`;

// ---------------------------------------------------------------------------
// Montagem dos nodes
// ---------------------------------------------------------------------------
const nodes = [];

nodes.push({
  // Path diferente do fluxo antigo de propósito: no n8n dois workflows ativos
  // não podem dividir o mesmo path. Assim o hotfix pode ser ativado e testado
  // com o atual ainda no ar, e a virada é só trocar a URL na Evolution
  // (rollback = apontar de volta).
  parameters: { httpMethod: "POST", path: "ia-whatsappinvent-v2", options: {} },
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position: [0, 0],
  id: byName["Webhook3"].id,
  name: "Webhook3",
  webhookId: "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b",
});

nodes.push({
  parameters: { jsCode: validarCode },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [240, 0],
  id: "a1f0c1e2-0001-4a01-9a01-100000000001",
  name: "1 - Validar e Normalizar",
});

const boolRule = (op, outputKey, id) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
    conditions: [
      {
        id,
        leftValue: "={{ $json.suportado }}",
        rightValue: "",
        operator: { type: "boolean", operation: op, singleValue: true },
      },
    ],
    combinator: "and",
  },
  renameOutput: true,
  outputKey,
});

nodes.push({
  parameters: {
    rules: {
      values: [
        boolRule("true", "texto", "b1f0c1e2-0002-4a02-9a02-200000000001"),
        boolRule("false", "midia", "b1f0c1e2-0002-4a02-9a02-200000000002"),
      ],
    },
    options: {},
  },
  type: "n8n-nodes-base.switch",
  typeVersion: 3.2,
  position: [480, 0],
  id: "a1f0c1e2-0002-4a02-9a02-100000000002",
  name: "2 - Tem Texto?",
});

const midiaMsg =
  "={{ $json.tipo === 'audio' ? 'Recebi seu áudio, mas ainda não consigo escutar mensagens de voz por aqui. Pode me escrever sua dúvida sobre a *Reforma Tributária* em texto? Assim eu te respondo na hora.' : 'Recebi sua mensagem, mas ainda não consigo ler esse tipo de conteúdo por aqui. Pode me escrever sua dúvida sobre a *Reforma Tributária* em texto? Assim eu te respondo na hora.' }}";

nodes.push({
  parameters: {
    assignments: {
      assignments: [
        { id: "c1f0c1e2-0003-4a03-9a03-300000000001", name: "numero", value: "={{ $json.numero }}", type: "string" },
        { id: "c1f0c1e2-0003-4a03-9a03-300000000002", name: "instancia", value: "={{ $json.instancia }}", type: "string" },
        { id: "c1f0c1e2-0003-4a03-9a03-300000000003", name: "message", value: midiaMsg, type: "string" },
      ],
    },
    options: {},
  },
  type: "n8n-nodes-base.set",
  typeVersion: 3.4,
  position: [720, 208],
  id: "a1f0c1e2-0003-4a03-9a03-100000000003",
  name: "2b - Pedir Texto",
});

nodes.push({
  parameters: {
    promptType: "define",
    text: "={{ $json.texto }}",
    options: { systemMessage, maxIterations: 8 },
  },
  type: "@n8n/n8n-nodes-langchain.agent",
  typeVersion: 2,
  position: [768, -32],
  id: byName["Router"].id,
  name: "3 - Agente Reforma Tributária",
});

nodes.push({
  parameters: { jsCode: saidaCode },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1152, -32],
  id: byName["6.0 - Normalizar AI Agent Output"].id,
  name: "4 - Normalizar Saída",
});

nodes.push({
  parameters: {
    resource: "messages-api",
    instanceName: "={{ $json.instancia }}",
    remoteJid: "={{ $json.numero }}",
    messageText: "={{ $json.message }}",
    options_message: {},
  },
  type: "n8n-nodes-evolution-api.evolutionApi",
  typeVersion: 1,
  position: [1440, 80],
  id: byName["9 - Enviar Resposta ao Cliente2"].id,
  name: "5 - Enviar Resposta",
  credentials: byName["9 - Enviar Resposta ao Cliente2"].credentials,
});

// --- sub-nodes do agente ---------------------------------------------------
nodes.push({
  ...byName["Google Gemini Chat Model"],
  position: [640, 240],
});

nodes.push({
  parameters: {
    sessionIdType: "customKey",
    sessionKey: "=chat_history:{{ $('1 - Validar e Normalizar').item.json.numero }}",
    sessionTTL: 259200,
    contextWindowLength: 40,
  },
  type: "@n8n/n8n-nodes-langchain.memoryRedisChat",
  typeVersion: 1.5,
  position: [800, 240],
  id: byName["Redis Chat Memory"].id,
  name: "Redis Chat Memory",
  credentials: byName["Redis Chat Memory"].credentials,
});

nodes.push({
  ...byName["Get a document in Google Docs"],
  position: [960, 240],
});

nodes.push({
  ...byName["HTTP Request"],
  parameters: {
    ...byName["HTTP Request"].parameters,
    toolDescription:
      "FONTE SECUNDÁRIA (imprensa especializada). Use apenas para contexto de mercado, nunca como norma, e sempre apresente o conteúdo como interpretação de terceiros.",
  },
  position: [1120, 240],
});

nodes.push({ ...byName["Calculator"], position: [1280, 240] });

nodes.push({
  ...byName["Date & Time"],
  parameters: { options: { timezone: "America/Sao_Paulo" } },
  position: [1440, 240],
});

// ---------------------------------------------------------------------------
// Conexões
// ---------------------------------------------------------------------------
const main = (node, index = 0) => ({ node, type: "main", index });

const connections = {
  Webhook3: { main: [[main("1 - Validar e Normalizar")]] },
  "1 - Validar e Normalizar": { main: [[main("2 - Tem Texto?")]] },
  "2 - Tem Texto?": {
    main: [[main("3 - Agente Reforma Tributária")], [main("2b - Pedir Texto")]],
  },
  "3 - Agente Reforma Tributária": { main: [[main("4 - Normalizar Saída")]] },
  "4 - Normalizar Saída": { main: [[main("5 - Enviar Resposta")]] },
  "2b - Pedir Texto": { main: [[main("5 - Enviar Resposta")]] },
  "Google Gemini Chat Model": {
    ai_languageModel: [[{ node: "3 - Agente Reforma Tributária", type: "ai_languageModel", index: 0 }]],
  },
  "Redis Chat Memory": {
    ai_memory: [[{ node: "3 - Agente Reforma Tributária", type: "ai_memory", index: 0 }]],
  },
  "Get a document in Google Docs": {
    ai_tool: [[{ node: "3 - Agente Reforma Tributária", type: "ai_tool", index: 0 }]],
  },
  "HTTP Request": {
    ai_tool: [[{ node: "3 - Agente Reforma Tributária", type: "ai_tool", index: 0 }]],
  },
  Calculator: {
    ai_tool: [[{ node: "3 - Agente Reforma Tributária", type: "ai_tool", index: 0 }]],
  },
  "Date & Time": {
    ai_tool: [[{ node: "3 - Agente Reforma Tributária", type: "ai_tool", index: 0 }]],
  },
};

const workflow = {
  name: "MUDANÇA FISCAL - Invent (hotfix)",
  nodes,
  pinData: {},
  connections,
  active: false,
  settings: original.settings,
  meta: original.meta,
  tags: original.tags,
};

const dest = process.argv[2];
fs.writeFileSync(dest, JSON.stringify(workflow, null, 2) + "\n");

// --- validações do próprio gerador ----------------------------------------
const nomes = new Set(nodes.map((n) => n.name));
if (nomes.size !== nodes.length) throw new Error("nome de node duplicado");
const ids = new Set(nodes.map((n) => n.id));
if (ids.size !== nodes.length) throw new Error("id de node duplicado");
for (const [from, saidas] of Object.entries(connections)) {
  if (!nomes.has(from)) throw new Error("conexão saindo de node inexistente: " + from);
  for (const grupos of Object.values(saidas)) {
    for (const grupo of grupos) {
      for (const c of grupo) {
        if (!nomes.has(c.node)) throw new Error("conexão para node inexistente: " + c.node);
      }
    }
  }
}
console.log("ok:", nodes.length, "nodes,", Object.keys(connections).length, "origens de conexão");

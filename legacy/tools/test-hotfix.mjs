import fs from "node:fs";

const wf = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const code = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const validar = code("1 - Validar e Normalizar");
const saida = code("4 - Normalizar Saída");

const runValidar = (items) => {
  const fn = new Function("$input", validar);
  return fn({ all: () => items });
};

const ev = (msg, over = {}) => ({
  json: {
    headers: {},
    query: {},
    body: {
      instance: "invent",
      data: {
        key: { remoteJid: "5562999998888@s.whatsapp.net", id: "ABC123", fromMe: false, ...(over.key || {}) },
        pushName: "Maria",
        message: msg,
      },
      ...(over.body || {}),
    },
    ...(over.top || {}),
  },
});

let falhas = 0;
const check = (nome, cond, extra = "") => {
  if (!cond) { falhas++; console.log("FALHOU:", nome, extra); }
  else console.log("ok   :", nome);
};

// --- tipos de mensagem (achado B1) ---
check("texto simples", runValidar([ev({ conversation: "O que é CBS?" })])[0].json.texto === "O que é CBS?");
check("texto citado/link", runValidar([ev({ extendedTextMessage: { text: "e o IBS?" } })])[0].json.texto === "e o IBS?");
check("botao", runValidar([ev({ buttonsResponseMessage: { selectedDisplayText: "Sim" } })])[0].json.texto === "Sim");
check("lista", runValidar([ev({ listResponseMessage: { title: "Créditos" } })])[0].json.texto === "Créditos");
check("imagem com legenda", runValidar([ev({ imageMessage: { caption: "isso muda?" } })])[0].json.texto === "isso muda?");

const audio = runValidar([ev({ audioMessage: { url: "x" } })])[0].json;
check("audio -> suportado=false, tipo=audio", audio.suportado === false && audio.tipo === "audio", JSON.stringify(audio));

const doc = runValidar([ev({ documentMessage: { fileName: "nf.pdf" } })])[0].json;
check("documento -> suportado=false", doc.suportado === false && doc.tipo === "documento");

check("imagem sem legenda -> suportado=false", runValidar([ev({ imageMessage: {} })])[0].json.suportado === false);
check("reacao descartada", runValidar([ev({ reactionMessage: { text: "👍" } })]).length === 0);
check("texto vazio -> suportado=false", runValidar([ev({ conversation: "   " })])[0].json.suportado === false);

// --- filtros de segurança ---
check("fromMe descartado", runValidar([ev({ conversation: "oi" }, { key: { fromMe: true } })]).length === 0);
check("grupo descartado", runValidar([ev({ conversation: "oi" }, { key: { remoteJid: "12036304@g.us" } })]).length === 0);
check("status@broadcast descartado", runValidar([ev({ conversation: "oi" }, { key: { remoteJid: "status@broadcast" } })]).length === 0);
check("jid malformado descartado", runValidar([ev({ conversation: "oi" }, { key: { remoteJid: "abc@s.whatsapp.net" } })]).length === 0);
check("instancia vazia descartada", runValidar([ev({ conversation: "oi" }, { body: { instance: "" } })]).length === 0);
check("payload vazio nao explode", runValidar([{ json: {} }]).length === 0);

// --- token (fail-open enquanto vazio, fail-closed depois de preenchido) ---
const comToken = validar.replace("const EXPECTED_TOKEN = '';", "const EXPECTED_TOKEN = 's3cr3t';");
const runComToken = (items) => new Function("$input", comToken)({ all: () => items });
check("token ausente -> descarta", runComToken([ev({ conversation: "oi" })]).length === 0);
check("token errado -> descarta", runComToken([ev({ conversation: "oi" }, { top: { query: { token: "x" } } })]).length === 0);
check("token certo por query -> passa", runComToken([ev({ conversation: "oi" }, { top: { query: { token: "s3cr3t" } } })]).length === 1);
check("token certo por header -> passa", runComToken([ev({ conversation: "oi" }, { top: { headers: { "x-invent-token": "s3cr3t" } } })]).length === 1);

const comAllow = validar.replace("const ALLOWED_INSTANCES = [];", "const ALLOWED_INSTANCES = ['invent'];");
const runAllow = (items) => new Function("$input", comAllow)({ all: () => items });
check("instancia fora da allowlist -> descarta", runAllow([ev({ conversation: "oi" }, { body: { instance: "outra" } })]).length === 0);
check("instancia na allowlist -> passa", runAllow([ev({ conversation: "oi" })]).length === 1);

// --- timezone (achado B3) ---
const tz = runValidar([ev({ conversation: "oi" })])[0].json;
const esperado = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
check("data em America/Sao_Paulo", tz.current_date === esperado, tz.current_date + " != " + esperado);
check("hora presente", /^[0-9]{2}:[0-9]{2}$/.test(tz.current_time), tz.current_time);

// --- normalizador de saída (achados B4/B5) ---
const runSaida = (output) => {
  const fn = new Function("$input", "$", saida);
  return fn(
    { item: { json: { output } } },
    () => ({ item: { json: { numero: "5562999998888@s.whatsapp.net", instancia: "invent" } } }),
  );
};
const url = "Veja https://lp.inventsoftware.com.br/simulador?utm_source=a+b";
check("URL preservada", runSaida(url)[0].json.message === url, runSaida(url)[0].json.message);
check("negrito ** convertido", runSaida("olha o **IBS**")[0].json.message === "olha o *IBS*");
check("saida vazia -> fallback", runSaida("")[0].json.message.startsWith("Tive um problema"));
check("saida nula -> fallback", runSaida(null)[0].json.message.startsWith("Tive um problema"));
check("objeto {text} aceito", runSaida({ text: "oi" })[0].json.message === "oi");
check("numero/instancia propagados", runSaida("oi")[0].json.numero === "5562999998888@s.whatsapp.net" && runSaida("oi")[0].json.instancia === "invent");
const jsonish = '{"action":"x"} e um link https://a.com/b';
check("JSON na saida nao e mais parseado", runSaida(jsonish)[0].json.message === jsonish);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + falhas + " FALHA(S)");
process.exit(falhas === 0 ? 0 : 1);

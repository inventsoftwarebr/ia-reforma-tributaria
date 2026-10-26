import { describe, expect, it } from "vitest";
import { chunkLegalText } from "./chunk";
import { decodeBytes, detectCharset, fileKind, htmlToText } from "./extract";

// Trecho no formato do Planalto: windows-1252, artigo partido no código-fonte,
// redação revogada riscada e entidades HTML.
const PLANALTO = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252">
<title>LCP 214</title><style>p{}</style></head><body>
<p align="center"><b>LEI COMPLEMENTAR N&ordm; 214, DE 16 DE JANEIRO DE 2025</b></p>
<p><a name="art1"></a>Art. 1&ordm; Ficam institu&iacute;dos:</p>
<p>I - o Imposto sobre Bens e Servi&ccedil;os (IBS);</p>
<p><strike>II - texto revogado que n&atilde;o pode
ser indexado;</strike></p>
<p>II - a Contribui&ccedil;&atilde;o Social sobre Bens
e Servi&ccedil;os (CBS);</p>
<p>Art. 2&ordm; O IBS e a CBS s&atilde;o informados pelo princ&iacute;pio da neutralidade.</p>
<p>&sect; 1&ordm; Par&aacute;grafo de teste.</p>
</body></html>`;

describe("htmlToText (Planalto)", () => {
  const text = htmlToText(PLANALTO);

  it("descarta a redação revogada (riscada)", () => {
    expect(text).not.toContain("revogado");
  });

  it("junta a linha partida no código-fonte e decodifica entidades", () => {
    expect(text).toContain("II - a Contribuição Social sobre Bens e Serviços (CBS);");
    expect(text).toContain("§ 1º Parágrafo de teste.");
  });

  it("cada artigo começa numa linha, como o chunking espera", () => {
    const chunks = chunkLegalText(text, { minChars: 10 });
    expect(chunks.map((chunk) => chunk.heading)).toEqual(
      expect.arrayContaining(["art. 1º", "art. 2º"]),
    );
  });

  it("não traz cabeçalho, título nem estilo", () => {
    expect(text).not.toContain("LCP 214");
    expect(text).not.toContain("p{}");
  });
});

describe("htmlToText (gov.br)", () => {
  const html = `<html><body><header>Menu do governo</header><nav>Ir para o conteúdo</nav>
<main><h1>Reforma Tributária</h1><p>${"A reforma simplifica a tributação sobre o consumo. ".repeat(6)}</p>
<h2>Perguntas frequentes</h2><ul><li>O que é a CBS?</li><li>O que é o IBS?</li></ul></main>
<footer>Rodapé</footer></body></html>`;
  const text = htmlToText(html);

  it("fica só com o conteúdo principal", () => {
    expect(text).not.toMatch(/Menu do governo|Ir para o conteúdo|Rodapé/);
  });

  it("converte títulos em seções Markdown e listas em itens", () => {
    expect(text).toContain("# Reforma Tributária");
    expect(text).toContain("## Perguntas frequentes");
    expect(text).toContain("- O que é a CBS?");
  });
});

describe("charset", () => {
  it("lê o charset declarado na página", () => {
    const bytes = new TextEncoder().encode('<meta charset="windows-1252">');
    expect(detectCharset(null, bytes)).toBe("windows-1252");
  });

  it("decodifica windows-1252 sem estragar acento", () => {
    const bytes = Uint8Array.from([
      0x41, 0x72, 0x74, 0x2e, 0x20, 0x31, 0xba, 0x20, 0xe7, 0xe3,
    ]);
    expect(decodeBytes(bytes, "text/html; charset=windows-1252")).toBe("Art. 1º çã");
  });
});

describe("fileKind", () => {
  it("reconhece os formatos aceitos", () => {
    expect(fileKind("lei.PDF")).toBe("pdf");
    expect(fileKind("apresentacao.docx")).toBe("docx");
    expect(fileKind("lcp214.htm")).toBe("html");
    expect(fileKind("faq.md")).toBe("text");
    expect(fileKind("planilha.xlsx")).toBeNull();
  });
});

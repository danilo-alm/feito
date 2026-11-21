import { describe, expect, it } from "vitest";
import { formatDescription } from "@feito/ui/client/description-formatting";

describe("formatação da descrição", () => {
  it("formata e remove a formatação da seleção preservando o texto em volta", () => {
    const formatted = formatDescription("Antes café depois", 6, 10, "bold", "texto");
    expect(formatted).toEqual({ value: "Antes **café** depois", start: 8, end: 12 });
    expect(formatDescription(formatted.value, formatted.start, formatted.end, "bold", "texto"))
      .toEqual({ value: "Antes café depois", start: 6, end: 10 });
  });

  it("insere e seleciona o texto substituível quando não há seleção", () => {
    expect(formatDescription("Olá ", 4, 4, "italic", "texto"))
      .toEqual({ value: "Olá *texto*", start: 5, end: 10 });
  });

  it("aplica listas às linhas selecionadas sem incluir a linha seguinte", () => {
    expect(formatDescription("Um\nDois\nTrês", 0, 8, "ordered", "texto").value).toBe("1. Um\n2. Dois\nTrês");
    expect(formatDescription("- Um\n- Dois", 0, 11, "list", "texto").value).toBe("Um\nDois");
    expect(formatDescription("Antes\nDois\nDepois", 8, 8, "heading", "texto").value).toBe("Antes\n# Dois\nDepois");
  });

  it("seleciona o endereço para completar um link e usa URLs selecionadas", () => {
    const link = formatDescription("Referência", 0, 10, "link", "texto");
    expect(link.value).toBe("[Referência](https://)");
    expect(link.value.slice(link.start, link.end)).toBe("https://");
    const url = formatDescription("https://example.com", 0, 19, "link", "texto");
    expect(url.value).toBe("[texto](https://example.com)");
    expect(url.value.slice(url.start, url.end)).toBe("texto");
  });

  it("mantém o Markdown de código multilinha em linhas próprias", () => {
    expect(formatDescription("Antes um\ndois depois", 6, 13, "code", "texto").value)
      .toBe("Antes \n```\num\ndois\n```\n depois");
  });

  it("não confunde itálico com negrito ao alternar", () => {
    expect(formatDescription("**café**", 2, 6, "italic", "texto").value).toBe("***café***");
    expect(formatDescription("***café***", 3, 7, "italic", "texto").value).toBe("**café**");
    expect(formatDescription("***café***", 3, 7, "bold", "texto").value).toBe("*café*");
    expect(formatDescription("*café*", 1, 5, "bold", "texto").value).toBe("***café***");
  });

  it("desfaz a formatação quando a seleção inclui os marcadores", () => {
    expect(formatDescription("a **café** b", 2, 10, "bold", "texto")).toEqual({ value: "a café b", start: 2, end: 6 });
    expect(formatDescription("~~velho~~", 0, 9, "strike", "texto").value).toBe("velho");
    expect(formatDescription("[Site](https://example.com)", 0, 27, "link", "texto").value).toBe("Site");  });

  it("alterna listas de tarefas e troca entre tipos de lista", () => {
    expect(formatDescription("Um\nDois", 0, 7, "task", "texto").value).toBe("- [ ] Um\n- [ ] Dois");
    expect(formatDescription("- [ ] Um\n- [x] Dois", 0, 19, "task", "texto").value).toBe("Um\nDois");
    expect(formatDescription("- [ ] Um", 0, 8, "list", "texto").value).toBe("- Um");
    expect(formatDescription("- Um\n- Dois", 0, 11, "ordered", "texto").value).toBe("1. Um\n2. Dois");
  });

  it("posiciona o cursor de forma útil com seleção vazia", () => {
    expect(formatDescription("", 0, 0, "task", "texto")).toEqual({ value: "- [ ] texto", start: 6, end: 11 });
    const cursor = formatDescription("Comprar pão", 3, 3, "list", "texto");
    expect(cursor).toEqual({ value: "- Comprar pão", start: 5, end: 5 });
    expect(formatDescription(cursor.value, cursor.start, cursor.end, "list", "texto")).toEqual({ value: "Comprar pão", start: 3, end: 3 });
    expect(formatDescription("Ver ", 4, 4, "link", "texto")).toEqual({ value: "Ver [texto](https://)", start: 5, end: 10 });
  });

  it("permite título no começo de uma descrição que inicia com linha vazia", () => {
    expect(formatDescription("\nDepois", 0, 0, "heading", "texto").value).toBe("# texto\nDepois");
  });
});

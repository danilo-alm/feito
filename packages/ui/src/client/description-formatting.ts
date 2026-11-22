export type DescriptionFormat = "heading" | "bold" | "italic" | "strike" | "link" | "list" | "ordered" | "task" | "quote" | "code";
export type TextSelection = { value: string; start: number; end: number };

const blockPatterns = {
  heading: /^#{1,6} /,
  // Uma lista de tarefas não conta como lista com marcadores, para que um formato troque pelo outro.
  list: /^[-+*] (?!\[[ xX]\] )/,
  ordered: /^\d+\. /,
  task: /^[-+*] \[[ xX]\] /,
  quote: /^> ?/,
} as const;
const blockPrefix = /^(?:#{1,6} |[-+*] \[[ xX]\] |[-+*] |\d+\. |> ?)/;

const countRun = (text: string, char: string, from: number, step: 1 | -1) => {
  let count = 0;
  for (let index = from; index >= 0 && index < text.length && text[index] === char; index += step) count++;
  return count;
};

/** Diz se há asteriscos suficientes dos dois lados para negrito ou itálico, sem confundir um com o outro. */
const hasEmphasis = (left: number, right: number, size: 1 | 2) =>
  size === 2 ? left >= 2 && right >= 2 : left % 2 === 1 && right % 2 === 1;

/** Transforma a seleção sem alterar o restante da descrição. Índices seguem o textarea (UTF-16). */
export function formatDescription(value: string, start: number, end: number, format: DescriptionFormat, placeholder: string): TextSelection {
  const selected = value.slice(start, end);
  const replace = (from: number, to: number, text: string, selectionStart: number, selectionEnd: number): TextSelection => ({
    value: value.slice(0, from) + text + value.slice(to), start: from + selectionStart, end: from + selectionEnd,
  });

  if (format === "heading" || format === "list" || format === "ordered" || format === "task" || format === "quote") {
    const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
    // Uma seleção até o início da próxima linha não inclui essa linha.
    const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const next = value.indexOf("\n", last);
    const to = next === -1 ? value.length : next;
    const lines = value.slice(from, to).split("\n");
    const pattern = blockPatterns[format];
    const remove = lines.every((line) => pattern.test(line));
    const text = lines.map((line, index) => {
      if (remove) return line.replace(pattern, "");
      const content = line.replace(blockPrefix, "");
      const prefix = format === "heading" ? "# " : format === "list" ? "- " : format === "task" ? "- [ ] "
        : format === "ordered" ? `${index + 1}. ` : "> ";
      return prefix + (content || placeholder);
    }).join("\n");
    if (start === end && lines.length === 1) {
      const content = lines[0].replace(blockPrefix, "");
      if (content || remove) {
        const cursor = Math.max(0, Math.min(text.length, start - from + text.length - lines[0].length));
        return replace(from, to, text, cursor, cursor);
      }
      return replace(from, to, text, Math.max(0, text.length - placeholder.length), text.length);
    }
    return replace(from, to, text, 0, text.length);
  }

  if (format === "link") {
    const existing = /^\[([^\]\n]*)\]\(([^)\s]*)\)$/.exec(selected);
    if (existing) return replace(start, end, existing[1], 0, existing[1].length);
    const url = /^https?:\/\/\S+$/.test(selected) ? selected : "https://";
    const label = url === selected ? placeholder : selected || placeholder;
    const text = `[${label}](${url})`;
    const offset = url === selected || !selected ? 1 : label.length + 3;
    return replace(start, end, text, offset, offset + (offset === 1 ? label.length : url.length));
  }

  const marker = format === "bold" ? "**" : format === "italic" ? "*" : format === "strike" ? "~~" : "`";
  const multilineCode = format === "code" && selected.includes("\n");
  const before = multilineCode ? `${start > 0 && value[start - 1] !== "\n" ? "\n" : ""}\`\`\`\n` : marker;
  const after = multilineCode ? `\n\`\`\`${end < value.length && value[end] !== "\n" ? "\n" : ""}` : marker;
  const emphasis = format === "bold" ? 2 : format === "italic" ? 1 : undefined;

  // Marcadores em volta da seleção: desfaz a formatação.
  const around = emphasis
    ? hasEmphasis(countRun(value, "*", start - 1, -1), countRun(value, "*", end, 1), emphasis)
    : start >= before.length && value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after;
  if (around) return replace(start - before.length, end + after.length, selected, 0, selected.length);

  // Marcadores dentro da seleção, como ao selecionar "**texto**" inteiro: também desfaz.
  const inner = selected.slice(before.length, selected.length - after.length);
  const inside = selected.length > before.length + after.length && (emphasis
    ? hasEmphasis(countRun(selected, "*", 0, 1), countRun(selected, "*", selected.length - 1, -1), emphasis)
      && countRun(selected, "*", 0, 1) < selected.length
    : selected.startsWith(before) && selected.endsWith(after));
  if (inside) return replace(start, end, inner, 0, inner.length);

  const content = selected || placeholder;
  return replace(start, end, before + content + after, before.length, before.length + content.length);
}

const quotePrefix = /^(?:[ \t]*> ?)*/;
const listPrefix = /^([ \t]*)(?:([-+*])|(\d{1,9})([.)]))( +)(\[[ xX]\] +)?/;
const fence = /^[ \t]{0,3}(?:```|~~~)/;

/**
 * Continua a lista ou citação da linha do cursor ao pressionar Enter. Um item vazio encerra o bloco.
 * Devolve null quando o Enter deve inserir uma quebra de linha comum.
 */
export function continueMarkdownBlock(value: string, start: number, end: number): TextSelection | null {
  if (start !== end) return null;
  const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const next = value.indexOf("\n", start);
  const line = value.slice(from, next === -1 ? value.length : next);
  const quote = quotePrefix.exec(line)![0];
  const list = listPrefix.exec(line.slice(quote.length));
  const prefix = quote + (list?.[0] ?? "");
  if (!prefix.trim() || start - from < prefix.length) return null;
  // Dentro de um bloco de código, as linhas não são marcadores.
  if (value.slice(0, from).split("\n").filter((text) => fence.test(text)).length % 2 === 1) return null;

  if (!line.slice(prefix.length).trim()) {
    const kept = list ? quote : "";
    return { value: value.slice(0, from) + kept + value.slice(from + line.length), start: from + kept.length, end: from + kept.length };
  }
  const marker = !list ? "" : list[1] + (list[2] ?? `${Number(list[3]) + 1}${list[4]}`) + list[5] + (list[6] ? "[ ] " : "");
  const text = `\n${quote}${marker}`;
  return { value: value.slice(0, start) + text + value.slice(start), start: start + text.length, end: start + text.length };
}

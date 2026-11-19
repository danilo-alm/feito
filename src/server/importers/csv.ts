import "server-only";

/**
 * Lê CSV no formato RFC 4180: campos entre aspas podem conter vírgulas, quebras de linha e `""`.
 * Remove o BOM inicial. Devolve cada registro com a linha do arquivo onde ele começa.
 */
export function parseCsv(text: string, delimiter = ",") {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let unterminated = false;

  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    records.push({ line: start, cells });
    cells = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) endCell();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      endRecord();
      line += 1;
      start = line;
    } else cell += char;
  }
  if (quoted) unterminated = true;
  if (cell !== "" || cells.length) endRecord();
  return { records, unterminated };
}

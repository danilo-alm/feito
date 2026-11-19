import "server-only";

type CsvRecord = { line: number; cells: string[] };

/** Lê registros sob demanda, preservando a linha inicial e o texto dentro de campos entre aspas. */
export function parseCsv(text: string, delimiter = ",") {
  let unterminated = false;

  function* readRecords(): Generator<CsvRecord> {
    let fragment = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    let cells: string[] = [];
    let cell = "";
    let quoted = false;
    let line = 1;
    let start = 1;

    const endCell = (index: number) => {
      cells.push(cell + text.slice(fragment, index));
      cell = "";
    };

    for (let index = fragment; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          cell += text.slice(fragment, index);
          if (text[index + 1] === '"') {
            cell += '"';
            index += 1;
          } else {
            quoted = false;
          }
          fragment = index + 1;
        } else if (char === "\n") {
          line += 1;
        }
        continue;
      }
      if (char === '"' && index === fragment && cell === "") {
        quoted = true;
        fragment = index + 1;
      } else if (char === delimiter) {
        endCell(index);
        fragment = index + 1;
      } else if (char === "\r" || char === "\n") {
        endCell(index);
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        yield { line: start, cells };
        cells = [];
        fragment = index + 1;
        line += 1;
        start = line;
      }
    }
    unterminated = quoted;
    if (fragment < text.length || cell !== "" || cells.length) {
      endCell(text.length);
      yield { line: start, cells };
    }
  }

  return { records: readRecords(), get unterminated() { return unterminated; } };
}

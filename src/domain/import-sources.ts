// Fontes externas de importação. Compartilhado entre interface e servidor:
// para adicionar uma fonte, registre-a aqui e implemente o importador em src/server/importers.

export type ImportSourceId = "todoist";

export type ImportSource = {
  id: ImportSourceId;
  name: string;
  /** O que o usuário envia, em poucas palavras. */
  fileKind: string;
  /** Valor do atributo accept do seletor de arquivos. */
  accept: string;
  /** Passos do fluxo, do app de origem até a revisão no Feito. */
  steps: { title: string; body: string }[];
};

export const importSources: readonly ImportSource[] = [
  {
    id: "todoist",
    name: "Todoist",
    fileKind: "CSV de projeto",
    accept: ".csv,text/csv",
    steps: [
      { title: "Exporte no Todoist", body: "No projeto, abra ⋯ → Importar e exportar → Exportar como CSV." },
      { title: "Envie os arquivos", body: "Um CSV por projeto. Pode mandar vários de uma vez." },
      { title: "Revise e importe", body: "Veja o que entra e o que precisa de ajuste antes de confirmar." },
    ],
  },
];

export function findImportSource(id: string) {
  return importSources.find((source) => source.id === id) ?? null;
}

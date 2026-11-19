// Modelos de exportação de um projeto. Compartilhado entre interface e servidor:
// para adicionar um modelo, registre-o aqui e implemente o exportador em src/server/exporters.

export type ExportFormatId = "todoist";

export type ExportOption = {
  id: string;
  label: string;
  hint: string;
  default: boolean;
};

export type ExportFormat = {
  id: ExportFormatId;
  name: string;
  /** O que o usuário recebe, em poucas palavras. */
  fileKind: string;
  /** Extensão do arquivo baixado, sem ponto. */
  extension: string;
  description: string;
  /** Opções liga/desliga enviadas como `?<id>=true|false`. */
  options: ExportOption[];
};

export const exportFormats: readonly ExportFormat[] = [
  {
    id: "todoist",
    name: "Todoist",
    fileKind: "CSV de projeto",
    extension: "csv",
    description: "Arquivo no formato de modelo do Todoist. No Todoist, crie um projeto e use Importar e exportar → Importar de CSV. Também pode ser importado de volta no Feito.",
    options: [
      {
        id: "relativeDates",
        label: "Usar datas relativas",
        hint: "Datas como “amanhã” ou “em 5 dias” passam a contar a partir do dia da importação.",
        default: false,
      },
    ],
  },
];

export function findExportFormat(id: string) {
  return exportFormats.find((format) => format.id === id) ?? null;
}

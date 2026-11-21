import type { ImportSourceId } from "../../domain/import-sources";
import type { Importer } from "./plan";
import { importTodoist } from "./todoist/index";

// Para uma nova fonte: registre-a em src/domain/import-sources.ts e mapeie o importador aqui.
export const importers: Record<ImportSourceId, Importer> = {
  todoist: importTodoist,
};

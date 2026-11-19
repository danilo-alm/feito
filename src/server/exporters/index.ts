import "server-only";
import type { ExportFormatId } from "@/domain/export-formats";
import { exportTodoist } from "./todoist";
import type { Exporter } from "./types";

// Para um novo modelo: registre-o em src/domain/export-formats.ts e mapeie o exportador aqui.
export const exporters: Record<ExportFormatId, Exporter> = {
  todoist: exportTodoist,
};

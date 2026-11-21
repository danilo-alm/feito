import { findExportFormat } from "../domain/export-formats";
import type { Product } from "../domain/product";
import { visibleRecord, validation } from "../product/product-rules";
import { exporters } from "./exporters/index";

/** Lê `format` e as opções liga/desliga do modelo; parâmetros desconhecidos ou repetidos são recusados. */
export function exportRequest(params: URLSearchParams) {
  const entries = [...params];
  if (new Set(entries.map(([name]) => name)).size !== entries.length) {
    throw validation("_query", "Cada parâmetro deve ser informado apenas uma vez.");
  }
  const format = findExportFormat(params.get("format") ?? "");
  if (!format) throw validation("format", "Escolha um modelo de exportação.");
  const options: Record<string, boolean> = Object.fromEntries(format.options.map((option) => [option.id, option.default]));
  for (const [name, value] of entries) {
    if (name === "format") continue;
    if (!(name in options) || (value !== "true" && value !== "false")) throw validation(name, "Opção inválida.");
    options[name] = value === "true";
  }
  return { format: format.id, options };
}

export function projectExport(product: Product, id: string, request: ReturnType<typeof exportRequest>) {
  return exporters[request.format](product, visibleRecord(product.projects, id), request.options);
}

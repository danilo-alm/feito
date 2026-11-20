import "server-only";
import { findExportFormat } from "@feito/core/domain/export-formats";
import { readProduct, type ProductAccess } from "@/server/db/product";
import { exporters } from "@/server/exporters";
import { visibleRecord, validation } from "@feito/core/product/product-rules";

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

export function exportProject(access: ProductAccess, id: string, request: ReturnType<typeof exportRequest>) {
  return readProduct(access, (product) => exporters[request.format](product, visibleRecord(product.projects, id), request.options));
}

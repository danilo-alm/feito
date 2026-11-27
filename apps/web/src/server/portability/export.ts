import "server-only";
import { exportDocument } from "@feito/core/portability/export";
import { readExportSnapshot, type ProductAccess } from "@/server/db/product";

export async function exportAccount(access: ProductAccess) {
  const { product, settings, occurrences, comments } = await readExportSnapshot(access);
  return exportDocument(product, settings, occurrences, comments);
}

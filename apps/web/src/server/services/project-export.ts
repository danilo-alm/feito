import "server-only";
import { exportRequest, projectExport } from "@feito/core/portability/project-export";
import { readProduct, type ProductAccess } from "@/server/db/product";

export { exportRequest };

export function exportProject(access: ProductAccess, id: string, request: ReturnType<typeof exportRequest>) {
  return readProduct(access, (product) => projectExport(product, id, request));
}

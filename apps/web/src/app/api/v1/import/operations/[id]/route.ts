import "server-only";
import { getImportOperation } from "@/server/db/portability";
import { productIdRoute } from "@/server/http/product-route";
import { json } from "@/server/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productIdRoute("/api/v1/import/operations/{operationId}", "import_operation",
  async (_request, access, id) => json(await getImportOperation(access, id)));

import "server-only";
import { randomUUID } from "node:crypto";
import { importUploadRoute } from "@/server/http/import-route";
import { json } from "@/server/http/route";
import { previewImport } from "@/server/services/portability";
import { invalidImport } from "@/server/portability/token";
import { entityId } from "@feito/core/validation/product";

export const runtime = "nodejs";

export const POST = importUploadRoute("/api/v1/import/preview", "import_preview", async (request, access, session, secret, file) => {
  const id = entityId.safeParse(request.headers.get("X-Operation-Id") ?? randomUUID());
  if (!id.success) throw invalidImport([{ path: "X-Operation-Id", message: "Informe um UUID válido." }]);
  const response = await previewImport(access, session.sessionId, id.data, secret, file);
  return json(response, 200, response.previewToken ? { "X-Operation-Id": id.data } : undefined);
});

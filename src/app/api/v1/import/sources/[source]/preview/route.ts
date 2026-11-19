import "server-only";
import { randomUUID } from "node:crypto";
import { importUploadRoute } from "@/server/http/import-route";
import { json } from "@/server/http/route";
import { invalidImport } from "@/server/portability/token";
import { previewSourceImport, sourceFor } from "@/server/services/source-import";
import { entityId } from "@/validation/product";

export const runtime = "nodejs";

type Params = { params: Promise<{ source: string }> };

export const POST = importUploadRoute("/api/v1/import/sources/{source}/preview", "import_source_preview",
  async (request, access, session, secret, file, context: Params) => {
    const source = sourceFor((await context.params).source);
    const id = entityId.safeParse(request.headers.get("X-Operation-Id") ?? randomUUID());
    if (!id.success) throw invalidImport([{ path: "X-Operation-Id", message: "Informe um UUID válido." }]);
    const response = await previewSourceImport(access, session.sessionId, source, id.data, secret, file);
    return json(response, 200, response.previewToken ? { "X-Operation-Id": id.data } : undefined);
  });

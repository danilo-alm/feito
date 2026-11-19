import "server-only";
import { importUploadRoute } from "@/server/http/import-route";
import { json } from "@/server/http/route";
import { invalidImport } from "@/server/portability/token";
import { confirmSourceImport, sourceFor } from "@/server/services/source-import";
import { entityId } from "@/validation/product";

export const runtime = "nodejs";

type Params = { params: Promise<{ source: string }> };

export const POST = importUploadRoute("/api/v1/import/sources/{source}/confirm", "import_source_confirm",
  async (request, access, session, secret, file, context: Params) => {
    const source = sourceFor((await context.params).source);
    const id = entityId.safeParse(request.headers.get("X-Operation-Id"));
    if (!id.success) throw invalidImport([{ path: "X-Operation-Id", message: "Informe um UUID válido." }]);
    const token = request.headers.get("X-Preview-Token");
    if (!token) throw invalidImport([{ path: "X-Preview-Token", message: "Informe o token da prévia." }]);
    return json(await confirmSourceImport(access, session.sessionId, source, id.data, token, secret, file));
  });

import "server-only";
import { importUploadRoute } from "@/server/http/import-route";
import { json } from "@/server/http/route";
import { invalidImport } from "@/server/portability/token";
import { confirmImport } from "@/server/services/portability";
import { entityId } from "@/validation/product";

export const runtime = "nodejs";

export const POST = importUploadRoute("/api/v1/import/confirm", "import_confirm", async (request, access, session, secret, file) => {
  const id = entityId.safeParse(request.headers.get("X-Operation-Id"));
  if (!id.success) throw invalidImport([{ path: "X-Operation-Id", message: "Informe um UUID válido." }]);
  const token = request.headers.get("X-Preview-Token");
  if (!token) throw invalidImport([{ path: "X-Preview-Token", message: "Informe o token da prévia." }]);
  return json(await confirmImport(access, session.sessionId, id.data, token, secret, file));
});

import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { reopenTask } from "@/server/services/tasks";
import { revisionInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/tasks/{id}/reopen", "reopen_task", async (request, access, id) => {
  const { revision } = await readProductJson(request, revisionInput);
  return json(await reopenTask(access, id, revision));
});

import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { undoTaskCompletion } from "@/server/services/tasks";
import { undoTaskCompletionInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/tasks/{id}/undo-completion", "undo_task_completion", async (request, access, id) => {
  return json(await undoTaskCompletion(access, id, await readProductJson(request, undoTaskCompletionInput)));
});

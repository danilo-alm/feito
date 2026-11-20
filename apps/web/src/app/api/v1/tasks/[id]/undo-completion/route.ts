import "server-only";
import { taskMutation } from "@/server/http/task-mutation";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { undoTaskCompletion } from "@/server/services/tasks";
import { undoTaskCompletionInput } from "@feito/core/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/tasks/{id}/undo-completion", "undo_task_completion", async (request, access, id) => {
  return taskMutation(request, access, async (write) => undoTaskCompletion(write, id, await readProductJson(request, undoTaskCompletionInput)));
});

import "server-only";
import { taskMutation } from "@/server/http/task-mutation";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { reopenTask } from "@/server/services/tasks";
import { revisionInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/tasks/{id}/reopen", "reopen_task", async (request, access, id) => {
  const { revision } = await readProductJson(request, revisionInput);
  return taskMutation(request, access, async (write) => reopenTask(write, id, revision));
});

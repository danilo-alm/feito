import "server-only";
import { taskMutation } from "@/server/http/task-mutation";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { completeTask } from "@/server/services/tasks";
import { completeTaskInput } from "@feito/core/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/tasks/{id}/complete", "complete_task", async (request, access, id) => {
  return taskMutation(request, access, async (write) => completeTask(write, id, await readProductJson(request, completeTaskInput)));
});

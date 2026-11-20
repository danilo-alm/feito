import "server-only";
import { taskMutation } from "@/server/http/task-mutation";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { moveTask } from "@/server/services/tasks";
import { taskMoveInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/tasks/{id}/move", "move_task", async (request, access, id) => {
  return taskMutation(request, access, async (write) => moveTask(write, id, await readProductJson(request, taskMoveInput)));
});

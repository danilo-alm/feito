import "server-only";
import { productIdRoute } from "@/server/http/product-route";
import { taskMutation } from "@/server/http/task-mutation";
import { duplicateTask } from "@/server/services/tasks";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/tasks/{id}/duplicate", "duplicate_task", async (request, access, id) => {
  return taskMutation(request, access, (write) => duplicateTask(write, id), 201);
});

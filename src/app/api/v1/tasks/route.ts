import "server-only";
import { taskMutation } from "@/server/http/task-mutation";
import { productRoute, readProductJson } from "@/server/http/product-route";
import { createTask } from "@/server/services/tasks";
import { createTaskInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productRoute("/api/v1/tasks", "create_task", async (request, access) => {
  return taskMutation(request, access, async (write) => createTask(write, await readProductJson(request, createTaskInput)), 201);
});

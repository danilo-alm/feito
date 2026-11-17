import "server-only";
import { productRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { createTask } from "@/server/services/tasks";
import { createTaskInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productRoute("/api/v1/tasks", "create_task", async (request, access) => {
  return json(await createTask(access, await readProductJson(request, createTaskInput)), 201);
});

import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { completeTask } from "@/server/services/tasks";
import { completeTaskInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/tasks/{id}/complete", "complete_task", async (request, access, id) => {
  return json(await completeTask(access, id, await readProductJson(request, completeTaskInput)));
});

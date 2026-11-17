import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { moveTask } from "@/server/services/tasks";
import { taskMoveInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/tasks/{id}/move", "move_task", async (request, access, id) => {
  return json(await moveTask(access, id, await readProductJson(request, taskMoveInput)));
});

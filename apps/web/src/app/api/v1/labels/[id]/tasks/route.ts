import "server-only";
import { productIdRoute } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { listLabelTasks } from "@/server/services/labels";
import { labelTasksQuery } from "@feito/core/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productIdRoute("/api/v1/labels/{id}/tasks", "label_tasks", async (request, access, id) => {
  const { cursor, limit } = readQuery(request, labelTasksQuery);
  return json(await listLabelTasks(access, id, limit, cursor));
});

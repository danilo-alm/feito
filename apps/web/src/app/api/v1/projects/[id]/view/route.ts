import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { updateProjectView } from "@/server/services/projects";
import { projectViewPatch } from "@feito/core/validation/product";

export const runtime = "nodejs";

export const PATCH = productIdRoute("/api/v1/projects/{id}/view", "project_view", async (request, access, id) => {
  const patch = await readProductJson(request, projectViewPatch);
  return json(await updateProjectView(access, id, patch));
});

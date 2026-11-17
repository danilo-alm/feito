import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { setProjectArchived } from "@/server/services/projects";
import { revisionInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/projects/{id}/unarchive", "unarchive_project", async (request, access, id) => {
  const { revision } = await readProductJson(request, revisionInput);
  return json(await setProjectArchived(access, id, revision, false));
});

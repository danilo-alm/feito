import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { moveProject } from "@/server/services/projects";
import { projectMoveInput } from "@feito/core/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/projects/{id}/move", "move_project", async (request, access, id) =>
  json(await moveProject(access, id, await readProductJson(request, projectMoveInput))));

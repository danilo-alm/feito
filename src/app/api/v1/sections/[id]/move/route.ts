import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { moveSection } from "@/server/services/projects";
import { sectionMoveInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/sections/{id}/move", "move_section", async (request, access, id) => {
  const { revision, ...anchor } = await readProductJson(request, sectionMoveInput);
  return json(await moveSection(access, id, revision, anchor));
});

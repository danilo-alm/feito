import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { createSection } from "@/server/services/projects";
import { createSectionInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/projects/{id}/sections", "create_section", async (request, access, id) => {
  const { name, ...anchor } = await readProductJson(request, createSectionInput);
  return json(await createSection(access, id, name, anchor), 201);
});

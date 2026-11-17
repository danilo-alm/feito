import "server-only";
import { productRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { createLabel, listLabels } from "@/server/services/labels";
import { nameInput } from "@/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productRoute("/api/v1/labels", "list_labels", async (_request, access) => {
  return json(await listLabels(access));
});

export const POST = productRoute("/api/v1/labels", "create_label", async (request, access) => {
  const { name } = await readProductJson(request, nameInput);
  return json(await createLabel(access, name), 201);
});

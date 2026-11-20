import "server-only";
import { noContent, productIdRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { deleteLabel, renameLabel } from "@/server/services/labels";
import { deleteQuery, editNameInput } from "@feito/core/validation/product";

export const runtime = "nodejs";

export const PATCH = productIdRoute("/api/v1/labels/{id}", "rename_label", async (request, access, id) => {
  const { revision, name } = await readProductJson(request, editNameInput);
  return json(await renameLabel(access, id, revision, name));
});

export const DELETE = productIdRoute("/api/v1/labels/{id}", "delete_label", async (request, access, id) => {
  const { revision } = readQuery(request, deleteQuery);
  await deleteLabel(access, id, revision);
  return noContent();
});

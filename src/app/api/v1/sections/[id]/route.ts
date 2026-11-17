import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { deleteSection, renameSection } from "@/server/services/projects";
import { deleteQuery, editNameInput } from "@/validation/product";

export const runtime = "nodejs";

export const PATCH = productIdRoute("/api/v1/sections/{id}", "rename_section", async (request, access, id) => {
  const { revision, name } = await readProductJson(request, editNameInput);
  return json(await renameSection(access, id, revision, name));
});

export const DELETE = productIdRoute("/api/v1/sections/{id}", "delete_section", async (request, access, id) => {
  const { revision } = readQuery(request, deleteQuery);
  return json(await deleteSection(access, id, revision));
});

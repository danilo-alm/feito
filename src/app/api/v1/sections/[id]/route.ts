import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { deleteSection, editSection } from "@/server/services/projects";
import { deleteQuery, editNamedDetailsInput } from "@/validation/product";

export const runtime = "nodejs";

export const PATCH = productIdRoute("/api/v1/sections/{id}", "edit_section", async (request, access, id) => {
  const { revision, ...patch } = await readProductJson(request, editNamedDetailsInput);
  return json(await editSection(access, id, revision, patch));
});

export const DELETE = productIdRoute("/api/v1/sections/{id}", "delete_section", async (request, access, id) => {
  const { revision } = readQuery(request, deleteQuery);
  return json(await deleteSection(access, id, revision));
});

import "server-only";
import { noContent, productIdRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { deleteProject, getProject, renameProject } from "@/server/services/projects";
import { deleteQuery, editNameInput, projectPageQuery } from "@/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productIdRoute("/api/v1/projects/{id}", "project", async (request, access, id) => {
  const { includeCompleted } = readQuery(request, projectPageQuery);
  return json(await getProject(access, id, includeCompleted));
});

export const PATCH = productIdRoute("/api/v1/projects/{id}", "rename_project", async (request, access, id) => {
  const { revision, name } = await readProductJson(request, editNameInput);
  return json(await renameProject(access, id, revision, name));
});

export const DELETE = productIdRoute("/api/v1/projects/{id}", "delete_project", async (request, access, id) => {
  const { revision } = readQuery(request, deleteQuery);
  await deleteProject(access, id, revision);
  return noContent();
});

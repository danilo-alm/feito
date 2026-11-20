import "server-only";
import { noContent, productIdRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { deleteProject, editProject, getProject } from "@/server/services/projects";
import { deleteQuery, editProjectInput, projectPageQuery } from "@feito/core/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productIdRoute("/api/v1/projects/{id}", "project", async (request, access, id) => {
  const { includeCompleted } = readQuery(request, projectPageQuery);
  return json(await getProject(access, id, includeCompleted));
});

export const PATCH = productIdRoute("/api/v1/projects/{id}", "edit_project", async (request, access, id) => {
  const { revision, ...patch } = await readProductJson(request, editProjectInput);
  return json(await editProject(access, id, revision, patch));
});

export const DELETE = productIdRoute("/api/v1/projects/{id}", "delete_project", async (request, access, id) => {
  const { revision } = readQuery(request, deleteQuery);
  await deleteProject(access, id, revision);
  return noContent();
});

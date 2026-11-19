import "server-only";
import { productRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { createProject, listProjects } from "@/server/services/projects";
import { createProjectInput, projectListQuery } from "@/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productRoute("/api/v1/projects", "list_projects", async (request, access) => {
  const { status } = readQuery(request, projectListQuery);
  return json(await listProjects(access, status));
});

export const POST = productRoute("/api/v1/projects", "create_project", async (request, access) => {
  const details = await readProductJson(request, createProjectInput);
  return json(await createProject(access, details), 201);
});

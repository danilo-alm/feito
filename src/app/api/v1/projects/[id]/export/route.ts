import "server-only";
import { productIdRoute } from "@/server/http/product-route";
import { exportProject, exportRequest } from "@/server/services/project-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function attachment(fileName: string) {
  const ascii = fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "_") || "projeto";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const GET = productIdRoute("/api/v1/projects/{id}/export", "project_export", async (request, access, id) => {
  const file = await exportProject(access, id, exportRequest(new URL(request.url).searchParams));
  return new Response(file.body, {
    headers: { "Content-Type": file.contentType, "Content-Disposition": attachment(file.fileName) },
  });
});

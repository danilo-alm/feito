import "server-only";
import { disableProjectShare, enableProjectShare, getProjectShare } from "@/server/db/project-shares";
import { noContent, productIdRoute } from "@/server/http/product-route";
import { json } from "@/server/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const path = "/api/v1/projects/{id}/share";

export const GET = productIdRoute(path, "project_share_status", async (_request, access, id) => {
  const token = await getProjectShare(access, id);
  return json({ enabled: token !== null, token });
});

export const PUT = productIdRoute(path, "enable_project_share", async (_request, access, id) => {
  const token = await enableProjectShare(access, id);
  return json({ enabled: true, token });
});

export const DELETE = productIdRoute(path, "disable_project_share", async (_request, access, id) => {
  await disableProjectShare(access, id);
  return noContent();
});

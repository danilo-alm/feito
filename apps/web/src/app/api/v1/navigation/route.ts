import "server-only";
import { productRoute } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { getNavigation } from "@/server/services/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productRoute("/api/v1/navigation", "navigation", async (_request, access) => {
  return json(await getNavigation(access));
});

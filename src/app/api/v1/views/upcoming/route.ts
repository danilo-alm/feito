import "server-only";
import { productRoute } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { getUpcoming } from "@/server/services/agenda";
import { upcomingQuery } from "@/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productRoute("/api/v1/views/upcoming", "upcoming", async (request, access) => {
  const { start } = readQuery(request, upcomingQuery);
  return json(await getUpcoming(access, start));
});

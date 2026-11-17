import "server-only";
import { productRoute } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { getToday } from "@/server/services/agenda";
import { todayQuery } from "@/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productRoute("/api/v1/views/today", "today", async (request, access) => {
  const { includeCompleted } = readQuery(request, todayQuery);
  return json(await getToday(access, includeCompleted));
});

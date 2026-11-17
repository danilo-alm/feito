import "server-only";
import { productRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";
import { searchTasks } from "@/server/services/search";
import { searchInput } from "@/validation/product";

export const runtime = "nodejs";

export const POST = productRoute("/api/v1/search", "search", async (request, access) => {
  const input = await readProductJson(request, searchInput);
  return json(await searchTasks(access, getRuntime().identity.config.secret, input));
});

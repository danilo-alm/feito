import "server-only";
import { sql } from "drizzle-orm";
import { ApiError } from "@/server/errors";
import { json, route } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("/api/health", "health", async () => {
  const { db, identity } = getRuntime();
  try {
    await Promise.all([db.execute(sql`select 1`), identity.db.execute(sql`select 1`)]);
  } catch {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Serviço temporariamente indisponível.");
  }
  return json({ status: "ok" });
});

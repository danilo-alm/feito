import "server-only";
import { json, route } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";
import { withSession } from "@/server/services/identity";
import { getMe } from "@/server/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("/api/v1/me", "workspace", async (request) => {
  const { db, keys, identity } = getRuntime();
  return withSession(identity, request.headers, { allowProvisional: true },
    async (session) => json(await getMe(db, keys, session)));
});

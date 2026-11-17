import "server-only";
import { json, route } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";
import { publicIdentity, withSession } from "@/server/services/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("/api/v1/auth/session", "session", async (request) =>
  withSession(getRuntime().identity, request.headers, { allowProvisional: true },
    async (session) => json(publicIdentity(session))));

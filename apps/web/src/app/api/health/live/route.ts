import "server-only";
import { json, route } from "@/server/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("/api/health/live", "liveness", async () => json({ status: "ok" }));

import "server-only";
import { attachCookies, requireOrigin, route } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";
import { logout } from "@/server/services/identity";

export const runtime = "nodejs";

export const POST = route("/api/v1/auth/logout", "logout", async (request) => {
  const { identity } = getRuntime();
  requireOrigin(request, identity.config.origin);
  const cookies = await logout(identity, request.headers);
  return attachCookies(new Response(null, { status: 204 }), cookies);
});

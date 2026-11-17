import "server-only";
import { changePasswordInput } from "@/validation/account";
import { readJson, requireOrigin, route } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";
import { changePassword, withSession } from "@/server/services/identity";

export const runtime = "nodejs";

export const POST = route("/api/v1/auth/password", "change_password", async (request) => {
  const { identity } = getRuntime();
  requireOrigin(request, identity.config.origin);
  return withSession(identity, request.headers, { allowProvisional: true, lock: "update" }, async (session, tx) => {
    await changePassword(tx, session, await readJson(request, changePasswordInput));
    return new Response(null, { status: 204 });
  });
});

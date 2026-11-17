import "server-only";
import { loginInput } from "@/validation/account";
import { attachCookies, json, readJson, requireOrigin, route } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";
import { login } from "@/server/services/identity";

export const runtime = "nodejs";

export const POST = route("/api/v1/auth/login", "login", async (request) => {
  const { identity } = getRuntime();
  requireOrigin(request, identity.config.origin);
  const input = await readJson(request, loginInput);
  const result = await login(identity, input, request.headers);
  return attachCookies(json(result.identity), result.cookies);
});

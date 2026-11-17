import "server-only";
import { preferencesPatch } from "@/validation/account";
import { json, readJson, requireOrigin, route } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";
import { withSession } from "@/server/services/identity";
import { updatePreferences } from "@/server/services/workspace";

export const runtime = "nodejs";

export const PATCH = route("/api/v1/preferences", "update_preferences", async (request) => {
  const { db, keys, identity } = getRuntime();
  requireOrigin(request, identity.config.origin);
  return withSession(identity, request.headers, { allowProvisional: false }, async (session) => {
    const patch = await readJson(request, preferencesPatch);
    return json(await updatePreferences(db, keys, session.tenantId, patch));
  });
});

import "server-only";
import { readDesktopSnapshot } from "@/server/db/product";
import { ApiError } from "@/server/errors";
import { productRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { getRuntime } from "@/server/runtime";
import { applyDesktopOperation, desktopCursorQuery, desktopOperationInput } from "@/server/services/desktop-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productRoute("/api/v1/desktop-sync", "desktop_pull", async (request, access, session) => {
  const { cursor, incremental } = readQuery(request, desktopCursorQuery);
  const snapshot = await readDesktopSnapshot(access, cursor, incremental === "1");
  return json({ ...snapshot, user: { id: session.id, email: session.email } });
});

export const POST = productRoute("/api/v1/desktop-sync", "desktop_push", async (request, access, session) => {
  const input = await readProductJson(request, desktopOperationInput);
  if (input.userId !== undefined && input.userId !== session.id) {
    throw new ApiError(409, "DESKTOP_ACCOUNT_CHANGED", "A alteração pertence a outra conta.");
  }
  return json(await applyDesktopOperation(access, getRuntime().identity.config.secret, input));
});

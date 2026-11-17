import "server-only";
import type { z } from "zod";
import { notFound } from "@/server/errors";
import type { ProductAccess } from "@/server/db/product";
import { getRuntime } from "@/server/runtime";
import { withSession } from "@/server/services/identity";
import { entityId } from "@/validation/product";
import { readJson, requireOrigin, route } from "./route";

function authorized(request: Request, handle: (access: ProductAccess) => Promise<Response>) {
  const { db, keys, identity } = getRuntime();
  if (request.method !== "GET" && request.method !== "HEAD") requireOrigin(request, identity.config.origin);
  return withSession(identity, request.headers, { allowProvisional: false },
    (session) => handle({ db, keys, tenantId: session.tenantId }));
}

export function productRoute(
  path: string, operation: string, handle: (request: Request, access: ProductAccess) => Promise<Response>,
) {
  return route(path, operation, (request) => authorized(request, (access) => handle(request, access)));
}

export function productIdRoute(
  path: string, operation: string, handle: (request: Request, access: ProductAccess, id: string) => Promise<Response>,
) {
  return route(path, operation, (request, context: { params: Promise<{ id: string }> }) =>
    authorized(request, async (access) => {
      const parsed = entityId.safeParse((await context.params).id);
      if (!parsed.success) throw notFound();
      return handle(request, access, parsed.data);
    }));
}

export function noContent() {
  return new Response(null, { status: 204 });
}

export function readProductJson<T>(request: Request, schema: z.ZodType<T>) {
  return readJson(request, schema, 256 * 1024);
}

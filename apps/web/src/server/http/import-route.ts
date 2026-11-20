import "server-only";
import type { ProductAccess } from "@/server/db/product";
import { getRuntime } from "@/server/runtime";
import { invalidImport } from "@/server/portability/token";
import type { IdentitySession } from "@/server/services/identity";
import { authorized } from "./product-route";
import { readBody, route } from "./route";

export function importUploadRoute<Context extends unknown[]>(
  path: string, operation: string,
  handle: (
    request: Request, access: ProductAccess, session: IdentitySession, secret: string, file: Buffer, ...context: Context
  ) => Promise<Response>,
) {
  return route(path, operation, async (request, ...context: Context) => {
    // Do not hold an identity transaction open while the client uploads a file.
    await authorized(request, async () => undefined);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw invalidImport([{ path: "", message: "Envie o arquivo com Content-Type application/json." }]);
    }
    const { portability } = getRuntime();
    const file = await readBody(request, portability.maxBytes, 60_000);
    try {
      return await authorized(request, (access, session) => handle(request, access, session, portability.previewSecret, file, ...context));
    } finally {
      file.fill(0);
    }
  });
}

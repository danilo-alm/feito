import "server-only";
import { eq } from "drizzle-orm";
import { tenants } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { ApiError } from "@/server/errors";
import { authorized, productRoute } from "@/server/http/product-route";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productRoute("/api/v1/product-events", "product_events", async (request, _, session) => {
  const { productEvents } = getRuntime();
  try {
    await productEvents.listen();
  } catch {
    throw new ApiError(503, "PRODUCT_EVENTS_UNAVAILABLE", "O canal de atualizações está indisponível.");
  }

  const encoder = new TextEncoder();
  let stopOnCancel = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let active = true;
      let dirty = false;
      let reading = false;
      let lastRevision: number | undefined;

      const cleanup = () => {
        active = false;
        clearInterval(heartbeat);
        clearTimeout(lease);
        unsubscribe();
        request.signal.removeEventListener("abort", stop);
      };
      const stop = () => {
        if (!active) return;
        cleanup();
        controller.close();
      };
      function send(message: string) {
        if (!active) return;
        if ((controller.desiredSize ?? 0) <= 0) return stop();
        controller.enqueue(encoder.encode(message));
      }

      async function refresh() {
        dirty = true;
        if (reading) return;
        reading = true;
        try {
          while (active && dirty) {
            dirty = false;
            const revision = await authorized(request, async ({ db, tenantId }, current) => {
              if (current.sessionId !== session.sessionId || tenantId !== session.tenantId) return undefined;
              return withTenant(db, tenantId, async (tx) => {
                const [tenant] = await tx.select({ revision: tenants.productRevision })
                  .from(tenants).where(eq(tenants.id, tenantId));
                return tenant?.revision;
              });
            });
            if (revision === undefined) return stop();
            if (revision !== lastRevision) {
              lastRevision = revision;
              send(`event: revision\ndata: ${revision}\n\n`);
            }
          }
        } catch {
          stop();
        } finally {
          reading = false;
        }
      }

      const unsubscribe = productEvents.subscribe(session.tenantId, { changed: refresh, disconnected: stop });
      const heartbeat = setInterval(() => send(": keepalive\n\n"), 15_000);
      const lease = setTimeout(stop, 5 * 60_000);
      request.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted) stop();
      else void refresh();
      // A canceled reader has already closed the controller.
      stopOnCancel = cleanup;
    },
    cancel() {
      stopOnCancel();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
});

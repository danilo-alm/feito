import "server-only";
import { productRoute } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { exportAccount } from "@/server/portability/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productRoute("/api/v1/export", "export_account", async (_request, access) => {
  const { document, referenceDate } = await exportAccount(access);
  return json(document, 200, { "Content-Disposition": `attachment; filename="feito-dados-${referenceDate}.json"` });
});

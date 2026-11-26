import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { moveLabel } from "@/server/services/labels";
import { orderMoveInput } from "@feito/core/validation/product";

export const runtime = "nodejs";

export const POST = productIdRoute("/api/v1/labels/{id}/move", "move_label", async (request, access, id) =>
  json(await moveLabel(access, id, await readProductJson(request, orderMoveInput))));

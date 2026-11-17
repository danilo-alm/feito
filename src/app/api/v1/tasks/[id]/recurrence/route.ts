import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { removeRecurrence, setRecurrence } from "@/server/services/tasks";
import { deleteQuery, setRecurrenceInput } from "@/validation/product";

export const runtime = "nodejs";

export const PUT = productIdRoute("/api/v1/tasks/{id}/recurrence", "set_recurrence", async (request, access, id) => {
  const input = await readProductJson(request, setRecurrenceInput);
  return json(await setRecurrence(access, id, input));
});

export const DELETE = productIdRoute("/api/v1/tasks/{id}/recurrence", "remove_recurrence", async (request, access, id) => {
  const { revision } = readQuery(request, deleteQuery);
  return json(await removeRecurrence(access, id, revision));
});

import "server-only";
import type { TaskChanges } from "@feito/core/types";
import type { ProductAccess } from "@/server/db/product";
import type { TaskAccess } from "@/server/services/tasks";
import { noContent } from "./product-route";
import { json } from "./route";

export async function taskMutation<T>(
  request: Request, access: ProductAccess, run: (access: TaskAccess) => Promise<T>, status = 200,
) {
  if (request.headers.get("X-Feito-Task-Changes") !== "1") {
    const result = await run(access);
    return status === 204 ? noContent() : json(result, status);
  }

  // Each transaction retry replaces the preview. Nothing is sent before the write commits.
  let changes: TaskChanges | undefined;
  const result = await run({ ...access, receiveChanges: (value) => { changes = value; } });
  return json({ result: result ?? null, changes }, status === 204 ? 200 : status);
}

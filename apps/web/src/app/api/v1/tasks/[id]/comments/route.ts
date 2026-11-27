import "server-only";
import { productIdRoute, readProductJson } from "@/server/http/product-route";
import { json } from "@/server/http/route";
import { createComment, listComments } from "@/server/services/comments";
import { createCommentInput } from "@feito/core/validation/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = productIdRoute("/api/v1/tasks/{id}/comments", "task_comments", async (_request, access, id) => {
  return json(await listComments(access, id));
});

export const POST = productIdRoute("/api/v1/tasks/{id}/comments", "create_comment", async (request, access, id) => {
  return json(await createComment(access, id, await readProductJson(request, createCommentInput)), 201);
});

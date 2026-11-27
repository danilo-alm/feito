import "server-only";
import { noContent, productIdRoute, readProductJson } from "@/server/http/product-route";
import { json, readQuery } from "@/server/http/route";
import { deleteComment, editComment } from "@/server/services/comments";
import { deleteQuery, editCommentInput } from "@feito/core/validation/product";

export const runtime = "nodejs";

export const PATCH = productIdRoute("/api/v1/comments/{id}", "edit_comment", async (request, access, id) => {
  return json(await editComment(access, id, await readProductJson(request, editCommentInput)));
});

export const DELETE = productIdRoute("/api/v1/comments/{id}", "delete_comment", async (request, access, id) => {
  await deleteComment(access, id, readQuery(request, deleteQuery).revision);
  return noContent();
});

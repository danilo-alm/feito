import "server-only";
import { createCommentsService } from "@feito/core/product/comments";
import { mutateComments, readComments } from "@/server/db/comments";
import type { ProductAccess } from "@/server/db/product";
import { allocateId } from "./product-id";

export const { listComments, createComment, editComment, deleteComment } = createCommentsService<ProductAccess>({
  allocateId, readComments, mutateComments,
});

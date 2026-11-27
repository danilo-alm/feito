import { compareComments, type TaskComment } from "../domain/product";
import type { CreateCommentInput, EditCommentInput } from "../validation/product";
import { ApiError } from "./errors";
import { commentDto } from "./product-dto";
import { requireRevision, writableProject } from "./product-rules";
import type { CommentContext, CommentPort } from "./port";

/** Upper bound of comments on a single task, which keeps the list read bounded. */
export const maxCommentsPerTask = 1_000;

export function createCommentsService<Access>({ allocateId, readComments, mutateComments }: CommentPort<Access>) {
  function existing({ comment }: CommentContext) {
    if (!comment) throw new Error("Comentário indisponível.");
    return comment;
  }

  async function listComments(access: Access, taskId: string) {
    const comments = await readComments(access, taskId);
    return { comments: [...comments].sort(compareComments).map(commentDto) };
  }

  function createComment(access: Access, taskId: string, input: CreateCommentInput) {
    const id = allocateId(access, 0);
    return mutateComments(access, { taskId }, ({ task, project, count, now }) => {
      writableProject(project);
      if (count >= maxCommentsPerTask) {
        throw new ApiError(422, "COMMENT_LIMIT", "Esta tarefa atingiu o limite de comentários.");
      }
      const comment: TaskComment = {
        id, taskId: task.id, revision: 1, data: { body: input.body, createdAt: now, editedAt: null },
      };
      return { value: commentDto(comment), upsert: comment };
    });
  }

  function editComment(access: Access, id: string, input: EditCommentInput) {
    return mutateComments(access, { commentId: id }, (context) => {
      const comment = existing(context);
      writableProject(context.project);
      requireRevision(comment, input.revision, () => commentDto(comment));
      if (comment.data.body === input.body) return { value: commentDto(comment) };
      const next: TaskComment = {
        ...comment, revision: comment.revision + 1, data: { ...comment.data, body: input.body, editedAt: context.now },
      };
      return { value: commentDto(next), upsert: next };
    });
  }

  function deleteComment(access: Access, id: string, revision: number) {
    return mutateComments(access, { commentId: id }, (context) => {
      const comment = existing(context);
      writableProject(context.project);
      requireRevision(comment, revision, () => commentDto(comment));
      return { value: undefined, remove: comment };
    });
  }

  return { listComments, createComment, editComment, deleteComment };
}

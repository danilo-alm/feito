"use client";

import type { TaskComment, TaskComments, TaskDetail } from "@feito/core/types";
import { ApiFailure, api } from "./api";
import { beginProjection, cacheScope, setQueryData, type QueryData } from "./store";

/** Query key of a task's comments: `useQuery<TaskComments>(commentsKey(id), () => loadComments(id))`. */
export const commentsKey = (taskId: string) => `comments:${taskId}`;
export const loadComments = (taskId: string) => api.comments.list(taskId);

const temporaryPrefix = "pending-comment:";
/** Comments still being created. Edits and removals of them wait for the creation to finish. */
export const isTemporaryComment = (id: string) => id.startsWith(temporaryPrefix);

// Latest confirmed revision of each comment written in this cache scope, so chained writes send the current one.
let revisionScope = cacheScope();
const revisions = new Map<string, number>();
// Server IDs of comments created from a temporary one, for edits queued before the creation finished.
const aliases = new Map<string, string>();

function sameScope() {
  if (revisionScope === cacheScope()) return true;
  revisionScope = cacheScope();
  revisions.clear();
  aliases.clear();
  return false;
}

function confirm(comment: TaskComment) {
  sameScope();
  revisions.set(comment.id, comment.revision);
}

const creations = new Map<string, Promise<TaskComment>>();
const queues = new Map<string, Promise<unknown>>();

function patchComments(data: QueryData, taskId: string, update: (comments: TaskComment[]) => TaskComment[]) {
  const key = commentsKey(taskId);
  const page = data.get(key) as TaskComments | undefined;
  if (page) data.set(key, { ...page, comments: update(page.comments) });
}

function patchCount(data: QueryData, taskId: string, delta: number) {
  const key = `task:${taskId}`;
  const detail = data.get(key) as TaskDetail | undefined;
  if (detail) data.set(key, { ...detail, commentCount: Math.max(0, detail.commentCount + delta) });
}

/** Applies a confirmed result to the loaded reads. */
function settle(taskId: string, update: (comments: TaskComment[]) => TaskComment[], countDelta = 0) {
  setQueryData<TaskComments>(commentsKey(taskId), (page) => page && { ...page, comments: update(page.comments) });
  if (countDelta) {
    setQueryData<TaskDetail>(`task:${taskId}`, (detail) =>
      detail && { ...detail, commentCount: Math.max(0, detail.commentCount + countDelta) });
  }
}

const replace = (comment: TaskComment) => (comments: TaskComment[]) =>
  comments.map((item) => item.id === comment.id ? comment : item);
const without = (id: string) => (comments: TaskComment[]) => comments.filter((item) => item.id !== id);

/** Runs writes to the same comment one after another, each with the revision left by the previous one. */
function enqueue<T>(id: string, run: () => Promise<T>) {
  const next = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(run);
  queues.set(id, next);
  void next.catch(() => undefined).finally(() => {
    if (queues.get(id) === next) queues.delete(id);
  });
  return next;
}

async function current(comment: TaskComment) {
  const created = creations.get(comment.id);
  const id = created ? (await created).id : (sameScope() && aliases.get(comment.id)) || comment.id;
  return { id, revision: (sameScope() ? revisions.get(id) : undefined) ?? comment.revision };
}

function keepLatest(failure: unknown, taskId: string) {
  const latest = failure instanceof ApiFailure && failure.code === "REVISION_CONFLICT"
    ? failure.details?.current as TaskComment | undefined : undefined;
  if (latest?.id) {
    confirm(latest);
    settle(taskId, replace(latest));
  }
}

/** Adds the comment at once and replaces it with the server copy when the write succeeds. */
export function createComment(taskId: string, body: string): Promise<TaskComment> {
  const text = body.trim();
  const draft: TaskComment = {
    id: temporaryPrefix + crypto.randomUUID(), taskId, revision: 1, body: text,
    createdAt: new Date().toISOString(), editedAt: null,
  };
  const layer = beginProjection((data) => {
    patchComments(data, taskId, (comments) => [...comments, draft]);
    patchCount(data, taskId, 1);
  });
  const created = api.comments.create(taskId, text).then((comment) => {
    confirm(comment);
    aliases.set(draft.id, comment.id);
    settle(taskId, (comments) => [...without(comment.id)(comments), comment], 1);
    return comment;
  }).finally(() => {
    layer.finish();
    creations.delete(draft.id);
  });
  creations.set(draft.id, created);
  return created;
}

/** Shows the new text at once. On failure only this edit is undone. */
export function editComment(comment: TaskComment, body: string): Promise<TaskComment> {
  const text = body.trim();
  const editedAt = new Date().toISOString();
  let targetId = comment.id;
  const layer = beginProjection((data) => patchComments(data, comment.taskId, (comments) => comments.map((item) =>
    item.id === comment.id || item.id === targetId ? { ...item, body: text, editedAt } : item)));
  return enqueue(comment.id, async () => {
    const target = await current(comment);
    targetId = target.id;
    try {
      const next = await api.comments.edit(target.id, target.revision, text);
      confirm(next);
      settle(next.taskId, replace(next));
      return next;
    } catch (failure) {
      keepLatest(failure, comment.taskId);
      throw failure;
    }
  }).finally(() => layer.finish());
}

/** Hides the comment at once. A comment already deleted elsewhere counts as removed. */
export function removeComment(comment: TaskComment): Promise<void> {
  let targetId = comment.id;
  const layer = beginProjection((data) => {
    patchComments(data, comment.taskId, (comments) => comments.filter((item) => item.id !== comment.id && item.id !== targetId));
    patchCount(data, comment.taskId, -1);
  });
  return enqueue(comment.id, async () => {
    const target = await current(comment);
    targetId = target.id;
    try {
      await api.comments.remove(target.id, target.revision);
    } catch (failure) {
      if (!(failure instanceof ApiFailure && failure.code === "NOT_FOUND")) {
        keepLatest(failure, comment.taskId);
        throw failure;
      }
    }
    revisions.delete(target.id);
    settle(comment.taskId, without(target.id), -1);
  }).finally(() => layer.finish());
}

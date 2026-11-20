"use client";
import { nextOccurrenceDate } from "@feito/core/domain/recurrence";
import { taskDescriptionExcerpt } from "@feito/core/domain/task-description";
import { taskAncestors } from "@feito/core/domain/task-tree";
import { ApiFailure, taskWrites } from "./api";
import { beginProjection, confirmedQueryData, invalidate, type QueryData } from "./store";
import { affectedTaskQuery, applyTaskChanges, taskOrigin, taskStates } from "./task-projections";
import type {
  CreateTask, EditTask, Label, MoveTarget, Navigation, ProjectPage, TaskChanges,
  TaskItem, TaskMutation, TaskState, UndoCompletionInput,
} from "@feito/core/types";

export type MutationContext = {
  reference: string;
  inboxId: string;
};

const temporaryId = () => `pending:${crypto.randomUUID()}`;
export const isTemporaryTask = (id: string) => id.startsWith("pending:");
type Edit = Omit<EditTask, "revision">;
type Preview = (draft: TaskDraft) => void;
type LabelEdit = (labelIds: string[]) => string[];

function selectLabels(data: QueryData, ids: string[]) {
  const labels = (data.get("labels") as { labels: Label[] } | undefined)?.labels
    ?? (data.get("nav") as Navigation | undefined)?.labels ?? [];
  return labels.filter((label) => ids.includes(label.id)).map(({ id, name }) => ({ id, name }));
}

function sameGroup(a: TaskState, b: Pick<TaskState, "projectId" | "sectionId" | "parentId">) {
  return a.projectId === b.projectId && a.sectionId === b.sectionId && a.parentId === b.parentId;
}

export class TaskDraft {
  readonly before: Map<string, TaskState>;
  readonly tasks: Map<string, TaskState>;
  private readonly touched = new Set<string>();
  private readonly groups = new Map<string, NonNullable<TaskChanges["groups"]>[number]>();

  constructor(readonly data: QueryData, readonly context: MutationContext, fallback?: TaskItem) {
    this.before = taskStates(data);
    if (fallback && !this.before.has(fallback.id)) this.before.set(fallback.id, fallback);
    this.tasks = new Map(this.before);
  }

  set(task: TaskState) {
    this.touched.add(task.id);
    this.tasks.set(task.id, {
      ...task, overdue: task.status === "active" && !!task.dueDate && task.dueDate < this.context.reference,
      origin: taskOrigin(this.data, this.tasks, task),
    });
  }

  put(task: TaskState, anchor?: { beforeId?: string; afterId?: string }) {
    const previous = this.tasks.get(task.id);
    this.set(task);
    if (previous && !sameGroup(previous, task)) this.order(previous, task.id);
    this.order(task, task.id, anchor, true);
  }

  branch(task: TaskState) {
    const direct = new Map<string, string[]>();
    for (const child of this.tasks.values()) {
      if (!child.parentId) continue;
      const ids = direct.get(child.parentId) ?? [];
      ids.push(child.id);
      direct.set(child.parentId, ids);
    }
    const result: TaskState[] = [];
    const seen = new Set([task.id]);
    const remaining = [...(direct.get(task.id) ?? [])];
    for (const id of remaining) {
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(this.tasks.get(id)!);
      remaining.push(...(direct.get(id) ?? []));
    }
    return result;
  }

  move(id: string, target: MoveTarget) {
    const task = this.tasks.get(id);
    if (!task) return;
    const parent = task.parentId ? this.tasks.get(task.parentId) : undefined;
    if (target.type === "promote") {
      if (!parent) return;
      target = { type: "position", projectId: parent.projectId, sectionId: parent.sectionId, parentId: parent.parentId, afterId: parent.id };
    }
    const destinationParent = target.parentId ? this.tasks.get(target.parentId) : undefined;
    if (target.parentId && !destinationParent) return;
    const branch = this.branch(task);
    if (target.parentId === id || branch.some((child) => child.id === target.parentId)) return;
    const { projectId, parentId } = target;
    const sectionId = destinationParent ? destinationParent.sectionId : target.sectionId;
    const origin = projectId === task.projectId && sectionId === task.sectionId ? task.origin : undefined;
    this.put({ ...task, projectId, sectionId, parentId, origin }, target);
    if (projectId !== task.projectId || sectionId !== task.sectionId) {
      for (const child of branch) this.set({ ...child, projectId, sectionId, origin: undefined });
    }
  }

  remove(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    for (const item of [task, ...this.branch(task)]) {
      this.tasks.delete(item.id);
      this.touched.add(item.id);
    }
    this.order(task, id);
  }

  private order(task: TaskState, id: string, anchor?: { beforeId?: string; afterId?: string }, insert = false) {
    const { projectId, sectionId, parentId } = task;
    const groupKey = JSON.stringify([projectId, sectionId, parentId]);
    const page = this.data.get(`project:${projectId}`) as ProjectPage | undefined;
    const preferred = this.groups.get(groupKey)?.orderedIds ?? (parentId ? this.tasks.get(parentId)?.childIds
      : page?.groups.find((group) => group.sectionId === sectionId)?.rootIds);
    const members = new Set([...this.tasks.values()].filter((item) => item.id !== id && sameGroup(item, task)).map((item) => item.id));
    // Some children may exist only as identifiers in the parent projection.
    const orderedIds = (preferred ?? []).filter((item) => item !== id && (!this.touched.has(item) || members.has(item)));
    for (const item of orderedIds) members.delete(item);
    orderedIds.push(...members);
    if (insert) {
      const anchorId = anchor?.beforeId ?? anchor?.afterId;
      const index = anchorId ? orderedIds.indexOf(anchorId) : -1;
      orderedIds.splice(index < 0 ? orderedIds.length : index + Number(!!anchor?.afterId), 0, id);
    }
    this.groups.set(groupKey, { projectId, sectionId, parentId, orderedIds });
  }

  changes(): TaskChanges {
    const parentDeltas = new Map<string, { total: number; completed: number }>();
    const adjust = (task: TaskState | undefined, direction: number) => {
      if (!task?.parentId) return;
      const delta = parentDeltas.get(task.parentId) ?? { total: 0, completed: 0 };
      delta.total += direction;
      if (task.status === "completed") delta.completed += direction;
      parentDeltas.set(task.parentId, delta);
    };
    for (const id of this.touched) {
      const before = this.before.get(id);
      const after = this.tasks.get(id);
      adjust(before, -1);
      adjust(after, 1);
      if (before && after && before.title !== after.title) {
        for (const child of this.tasks.values()) {
          if (child.parentId === id) this.set(child);
        }
      }
    }
    for (const [id, delta] of parentDeltas) {
      const parent = this.tasks.get(id);
      if (!parent) continue;
      const group = this.groups.get(JSON.stringify([parent.projectId, parent.sectionId, id]));
      if (group || delta.total || delta.completed) {
        this.set({
          ...parent, childIds: group?.orderedIds ?? parent.childIds,
          subtasks: { total: parent.subtasks.total + delta.total, completed: parent.subtasks.completed + delta.completed },
        });
      }
    }
    return {
      revision: 0,
      rows: [...this.touched].map((id) => ({ before: this.before.get(id), after: this.tasks.get(id) }))
        .filter(({ before, after }) => before || after),
      groups: [...this.groups.values()],
    };
  }
}

function predictCreate(draft: TaskDraft, id: string, input: CreateTask) {
  const parent = input.parentId ? draft.tasks.get(input.parentId) : undefined;
  const projectId = parent?.projectId ?? input.projectId ?? draft.context.inboxId;
  const sectionId = parent ? parent.sectionId : input.sectionId ?? null;
  const parentId = input.parentId ?? null;
  const anchorDate = input.recurrence?.anchorDate ?? input.dueDate ?? null;
  const dueDate = input.dueDate ?? (input.recurrence ? anchorDate : null);
  const dueTime = input.dueTime === undefined ? input.recurrence?.time ?? null : input.dueTime;
  const recurrenceRule = input.recurrence && anchorDate ? {
    frequency: input.recurrence.frequency, anchorDate, nominalDate: anchorDate,
    time: input.recurrence.time === undefined ? dueTime : input.recurrence.time,
  } : null;
  const description = input.description ?? "";
  const page = draft.data.get(`project:${projectId}`) as ProjectPage | undefined;
  const anchor = !page || page.project.view.sortMode === "manual" ? input : undefined;
  draft.put({
    id, revision: 0, projectId, sectionId, parentId, title: input.title, description,
    descriptionExcerpt: taskDescriptionExcerpt(description), priority: input.priority ?? 4, status: "active",
    completedAt: null, dueDate, dueTime, overdue: false, recurrenceRule,
    recurrence: recurrenceRule ? { frequency: recurrenceRule.frequency } : null,
    occurrenceId: null, childIds: [], subtasks: { total: 0, completed: 0 }, labels: selectLabels(draft.data, input.labelIds ?? []),
  }, anchor);
}

function predictEdit(draft: TaskDraft, id: string, patch: Edit) {
  const task = draft.tasks.get(id);
  if (!task) return;
  const { labelIds, recurrence, destination, description, ...fields } = patch;
  const next: TaskState = { ...task, ...fields };
  if (description !== undefined) {
    next.description = description;
    next.descriptionExcerpt = taskDescriptionExcerpt(description);
  }
  if (next.dueDate === null && fields.dueTime === undefined) next.dueTime = null;
  if (labelIds !== undefined) next.labels = selectLabels(draft.data, labelIds);
  if (recurrence === null) {
    next.recurrence = null;
    next.recurrenceRule = null;
    next.occurrenceId = null;
  } else if (recurrence) {
    next.dueDate = recurrence.anchorDate;
    next.dueTime = recurrence.time ?? null;
    next.recurrence = { frequency: recurrence.frequency };
    next.recurrenceRule = { ...next.recurrence, anchorDate: next.dueDate, nominalDate: next.dueDate, time: next.dueTime };
  }
  draft.set(next);
  if (destination && !sameGroup(task, { ...destination, parentId: null })) {
    draft.move(id, { type: "position", ...destination, parentId: null });
  }
}

function predictComplete(draft: TaskDraft, id: string, completedAt: string, includeChildren: boolean) {
  const task = draft.tasks.get(id);
  if (!task) return;
  if (task.recurrence && task.dueDate) {
    const rule = task.recurrenceRule ?? {
      ...task.recurrence, anchorDate: task.dueDate, nominalDate: task.dueDate, time: task.dueTime,
    };
    const dueDate = nextOccurrenceDate(rule, task.dueDate, draft.context.reference);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;
    draft.set({ ...task, dueDate, dueTime: rule.time, recurrenceRule: { ...rule, nominalDate: dueDate } });
  } else {
    const children = includeChildren ? draft.branch(task) : [];
    for (const item of [task, ...children]) {
      if (item.status === "active") draft.set({ ...item, status: "completed", completedAt });
    }
  }
}

function predictReopen(draft: TaskDraft, id: string, children: string[] = []) {
  const task = draft.tasks.get(id);
  if (!task) return;
  draft.set({ ...task, status: "active", completedAt: null });
  for (const parent of taskAncestors(task, draft.tasks)) {
    if (parent.status === "active") break;
    draft.set({ ...parent, status: "active", completedAt: null });
  }
  for (const childId of children) {
    const child = draft.tasks.get(childId);
    if (child) draft.set({ ...child, status: "active", completedAt: null });
  }
}

type WriteQueue = { settled: Promise<unknown>; latest?: TaskItem };
const writes = new Map<TaskItem["id"], WriteQueue>();
const projectMoves = new Map<string, Promise<unknown>>();

function perform<T>(
  context: MutationContext,
  fallback: TaskItem | undefined,
  preview: Preview,
  send: (current: TaskState | undefined, confirm: (changes: TaskChanges, remaining: Preview) => void) => Promise<TaskMutation<T>>,
  taskOf?: (result: T) => TaskItem,
  serializeProject?: string,
) {
  const refresh = new Set<string>();
  const project = (predict: Preview) => (data: QueryData) => {
    const draft = new TaskDraft(data, context, fallback);
    predict(draft);
    const changes = draft.changes();
    const previous = new Map(data);
    applyTaskChanges(data, changes);
    for (const [key, before] of previous) if (data.get(key) !== before) refresh.add(key);
  };
  const layer = beginProjection(project(preview));
  const preceding = fallback ? writes.get(fallback.id) : undefined;
  const ticket: WriteQueue = { settled: Promise.resolve() };
  const done = async () => {
    if (!layer.active()) throw new ApiFailure(401, "UNAUTHENTICATED", "A sessão foi encerrada.");
    const base = confirmedQueryData();
    const known = fallback && taskStates(base).get(fallback.id);
    const prior = preceding?.latest;
    const latest = known && known.revision > (prior?.revision ?? 0) ? known : prior ?? known ?? fallback;
    const reread = (extra: TaskChanges = { revision: 0, rows: [] }) => invalidate((key) =>
      refresh.has(key) || (!!fallback && key === `task:${fallback.id}`) || affectedTaskQuery(key, base.get(key), extra));
    try {
      const response = await send(latest, (changes, remaining) => {
        layer.confirm({ revision: changes.revision, apply: (data) => applyTaskChanges(data, changes) }, project(remaining));
      });
      ticket.latest = taskOf?.(response.result) ?? latest;
      const { result, changes } = response;
      layer.confirm({ revision: changes.revision, apply: (data) => applyTaskChanges(data, changes) });
      if (!changes.rows.length && ticket.latest && latest && ticket.latest.revision !== latest.revision) void reread();
      return result;
    } catch (error) {
      const current = error instanceof ApiFailure ? error.details?.current as TaskState | undefined : undefined;
      if (current?.id === fallback?.id) ticket.latest = current;
      else ticket.latest = latest;
      if (!layer.active()) throw error;
      layer.finish();
      if (!(error instanceof ApiFailure) || error.status === 0 || error.status >= 500
        || ["REVISION_CONFLICT", "OCCURRENCE_STALE", "UNDO_UNAVAILABLE", "NOT_FOUND", "HAS_CHILDREN", "HAS_ACTIVE_CHILDREN", "PROJECT_ARCHIVED"].includes(error.code)) {
        void reread(current ? { revision: 0, rows: [{ before: fallback, after: current }] } : undefined);
      }
      throw error;
    }
  };
  const projectMove = serializeProject ? projectMoves.get(serializeProject) : undefined;
  const dependencies = [preceding?.settled, projectMove].filter((dependency) => dependency !== undefined);
  const result = dependencies.length ? Promise.allSettled(dependencies).then(done) : done();
  ticket.settled = result;
  if (serializeProject) {
    projectMoves.set(serializeProject, result);
    const release = () => {
      if (projectMoves.get(serializeProject) === result) projectMoves.delete(serializeProject);
    };
    void result.then(release, release);
  }
  if (fallback) {
    writes.set(fallback.id, ticket);
    const release = () => {
      if (writes.get(fallback.id) === ticket) writes.delete(fallback.id);
    };
    void ticket.settled.then(release, release);
  }
  return result;
}

export function createTask(context: MutationContext, input: CreateTask) {
  const id = temporaryId();
  return perform(context, undefined, (draft) => predictCreate(draft, id, input), () => taskWrites.create(input));
}

export function duplicateTask(context: MutationContext, task: TaskItem) {
  const id = temporaryId();
  return perform(context, task, (draft) => {
    const source: TaskState = draft.tasks.get(task.id) ?? task;
    predictCreate(draft, id, {
      ...source, description: source.description ?? source.descriptionExcerpt ?? "",
      labelIds: source.labels.map((label) => label.id), recurrence: source.recurrence ?? undefined, afterId: task.id,
    });
  }, () => taskWrites.duplicate(task.id));
}

export function editTask(context: MutationContext, task: TaskItem, patch: Edit | LabelEdit, expected = task.revision) {
  const fields = (current: TaskState): Edit => typeof patch === "function"
    ? { labelIds: patch(current.labels.map((label) => label.id)) } : patch;
  // A picker that has been open must still detect revisions older than its own draft.
  return perform(context, { ...task, revision: expected }, (draft) => {
    predictEdit(draft, task.id, fields(draft.tasks.get(task.id) ?? task));
  }, (current) => taskWrites.edit(task.id, { revision: expected === task.revision ? current!.revision : expected, ...fields(current!) }), (result) => result);
}

export function moveTask(context: MutationContext, task: TaskItem, steps: readonly MoveTarget[]) {
  const preview = (remaining: readonly MoveTarget[]) => (draft: TaskDraft) => {
    for (const step of remaining) draft.move(task.id, step);
  };
  return perform(context, task, preview(steps), async (current, confirm) => {
    let revision = current!.revision;
    for (const [index, step] of steps.entries()) {
      const response = await taskWrites.move(task.id, revision, step);
      if (index === steps.length - 1) return response;
      confirm(response.changes, preview(steps.slice(index + 1)));
      revision = response.result.task.revision;
    }
    throw new Error("Movimento sem destino.");
  }, (result) => result.task, task.projectId);
}

export function completeTask(context: MutationContext, task: TaskItem, includeChildren = false) {
  const now = new Date().toISOString();
  return perform(context, task, (draft) => {
    const current = draft.tasks.get(task.id);
    if (includeChildren || current?.subtasks.total === current?.subtasks.completed) {
      predictComplete(draft, task.id, now, includeChildren);
    }
  }, async (current) => {
    const previous = current!;
    const response = await taskWrites.complete(task.id, {
      revision: previous.revision, occurrenceId: previous.occurrenceId ?? undefined, includeChildren,
    });
    return { ...response, result: { ...response.result, previous } };
  }, (result) => result.task);
}

export function reopenTask(context: MutationContext, task: TaskItem) {
  return perform(context, task, (draft) => predictReopen(draft, task.id),
    (current) => taskWrites.reopen(task.id, current!.revision), (result) => result.task);
}

export function undoTask(context: MutationContext, task: TaskItem, input: UndoCompletionInput) {
  return perform(context, task, (draft) => {
    if (!input.occurrenceId) {
      predictReopen(draft, task.id, input.completedChildIds);
      return;
    }
    const current = draft.tasks.get(task.id);
    if (current) draft.set({
      ...current, dueDate: task.dueDate, dueTime: task.dueTime, occurrenceId: task.occurrenceId,
      recurrenceRule: task.recurrenceRule,
    });
  }, () => taskWrites.undo(task.id, input), (result) => result.task);
}

export function removeTask(context: MutationContext, task: TaskItem) {
  return perform(context, task, (draft) => draft.remove(task.id),
    (current) => taskWrites.remove(task.id, current!.revision, task.subtasks.total > 0));
}

import { Temporal } from "@js-temporal/polyfill";
import type { Preferences } from "../types";
import { defaultPreferences, referenceDate } from "../domain/preferences";
import {
  inboxName, isActive, type CompletedOccurrence, type Label, type OccurrenceReference,
  type Product, type Project, type Section, type Task,
} from "../domain/product";
import type { MutationHistory, ProductCalendar, ProductProjection, ProductSummary, TaskView, TaskViewScope } from "./port";
import { notFound } from "./errors";
import { defaultsForView } from "../validation/product";

export type Workspace = {
  preferences: Preferences;
  projects: Project[];
  sections: Section[];
  tasks: Task[];
  labels: Label[];
  taskLabels: [string, string[]][];
  occurrences: CompletedOccurrence[];
};

export function newWorkspace(): Workspace {
  const preferences = { ...defaultPreferences };
  return {
    preferences,
    projects: [{
      id: globalThis.crypto.randomUUID(), revision: 1, isInbox: true,
      data: {
        name: inboxName, description: "", color: null, icon: "hash", archived: false,
        view: { ...defaultsForView }, createdAt: Temporal.Now.instant().toString(),
      },
    }],
    sections: [], tasks: [], labels: [], taskLabels: [], occurrences: [],
  };
}

function records<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]));
}

export function asProduct(workspace: Workspace, now = Temporal.Now.instant()): Product {
  const { timezone } = workspace.preferences;
  return {
    projects: records(workspace.projects), sections: records(workspace.sections),
    tasks: records(workspace.tasks), labels: records(workspace.labels), taskLabels: new Map(workspace.taskLabels),
    now, timezone, referenceDate: referenceDate(timezone, now),
  };
}

export type ProductAccess = {
  workspace: Workspace;
  revision: number;
  authoredAt?: string;
  allocateId: (slot: number) => string;
};

function occurrenceMatches(record: OccurrenceReference, reference: OccurrenceReference) {
  return record.taskId === reference.taskId && record.occurrenceId === reference.occurrenceId;
}

// Shared callbacks use copy-on-write on the record maps. Publish a workspace
// only after the whole callback (including its invariant checks) succeeds.
export async function mutateProduct<T>(
  access: ProductAccess,
  apply: (draft: Product, original: Product, history: MutationHistory, revision: number) => T,
  occurrence?: OccurrenceReference,
  options: { removeOccurrence?: OccurrenceReference } = {},
): Promise<T> {
  const workspace = access.workspace;
  const now = access.authoredAt ? Temporal.Instant.from(access.authoredAt) : Temporal.Now.instant();
  const original = asProduct(workspace, now);
  const draft = asProduct(workspace, now);
  const previousCompletion = occurrence
    ? workspace.occurrences.find((record) => occurrenceMatches(record, occurrence)) : undefined;
  const history: MutationHistory = { recorded: previousCompletion !== undefined, previousCompletion };
  const value = apply(draft, original, history, access.revision);
  const occurrences = workspace.occurrences.filter((record) => draft.tasks.has(record.taskId)
    && !(options.removeOccurrence && occurrenceMatches(record, options.removeOccurrence)));
  if (history.completion) occurrences.push(history.completion);
  access.workspace = {
    preferences: workspace.preferences,
    projects: Array.from(draft.projects.values()), sections: Array.from(draft.sections.values()),
    tasks: Array.from(draft.tasks.values()), labels: Array.from(draft.labels.values()),
    taskLabels: Array.from(draft.taskLabels), occurrences,
  };
  return value;
}

export async function readTaskDetail(access: ProductAccess, id: string) {
  const product = asProduct(access.workspace);
  const task = product.tasks.get(id);
  if (!task) throw notFound();
  return { product, task };
}

export async function readProjectView(access: ProductAccess, id: string) {
  const product = asProduct(access.workspace);
  const project = product.projects.get(id);
  if (!project) throw notFound();
  return { product, project };
}

function increment(counts: Map<string, number>, id: string) {
  counts.set(id, (counts.get(id) ?? 0) + 1);
}

export async function readProductSummary<T>(
  access: ProductAccess, projection: ProductProjection, select: (summary: ProductSummary, calendar: ProductCalendar | undefined) => T,
) {
  const product = asProduct(access.workspace);
  const { projects, labels, referenceDate, timezone } = product;
  const summary: ProductSummary = { projects, labels, projectCounts: new Map(), labelCounts: new Map(), todayCount: 0 };
  for (const task of product.tasks.values()) {
    if (!isActive(task) || projects.get(task.projectId)?.data.archived !== false) continue;
    increment(summary.projectCounts, task.projectId);
    if (task.data.dueDate && task.data.dueDate <= referenceDate) summary.todayCount++;
    for (const id of product.taskLabels.get(task.id) ?? []) increment(summary.labelCounts, id);
  }
  return select(summary, projection === "navigation" ? { referenceDate, timezone } : undefined);
}

export async function readTaskView<T>(access: ProductAccess, scope: TaskViewScope, run: (view: TaskView) => Promise<T>) {
  const product = asProduct(access.workspace);
  if (scope.projectId && !product.projects.has(scope.projectId)) throw notFound();
  if (scope.labelId && !product.labels.has(scope.labelId)) throw notFound();
  const page = scope.operation === "label" ? scope.page : undefined;
  const after = page?.after();
  const candidates = [...product.tasks.values()].filter((task) =>
    !scope.skipTasks && product.projects.get(task.projectId)?.data.archived === false
    && (!scope.projectId || task.projectId === scope.projectId)
    && (!scope.labelId || product.taskLabels.get(task.id)?.includes(scope.labelId))
    && (!page || (isActive(task) && (!after || task.id > after))),
  );
  const selected = page
    ? candidates.sort((left, right) => left.id.localeCompare(right.id)).slice(0, page.limit) : candidates;
  return run({
    referenceDate: product.referenceDate, timezone: product.timezone,
    candidates: records(selected), contextFor: async () => product,
  });
}

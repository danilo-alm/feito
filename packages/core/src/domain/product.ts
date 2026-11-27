import { Temporal } from "@js-temporal/polyfill";
import type { CompletedOccurrencePayload, LabelPayload, ProjectPayload, SectionPayload, TaskPayload } from "../validation/product";
import { walkTaskTree } from "./task-tree";

// Nome gravado no projeto da Entrada (dados e importação); a interface mostra “Entrada”.
export const inboxName = "Caixa de entrada";

type RecordData<T> = { id: string; revision: number; data: T };
export type Project = RecordData<ProjectPayload> & { isInbox: boolean };
export type Section = RecordData<SectionPayload> & { projectId: string };
export type Label = RecordData<LabelPayload>;
export type TaskGroup = { projectId: string; sectionId: string | null; parentId: string | null };
export type Task = RecordData<TaskPayload> & TaskGroup & { occurrenceId: string | null };

export type OccurrenceReference = { taskId: string; occurrenceId: string };
export type CompletedOccurrence = OccurrenceReference & { data: CompletedOccurrencePayload };

export type Product = {
  projects: Map<string, Project>;
  sections: Map<string, Section>;
  tasks: Map<string, Task>;
  labels: Map<string, Label>;
  taskLabels: Map<string, string[]>;
  referenceDate: string;
  timezone: string;
  now: Temporal.Instant;
};

export function byPosition<T extends { id: string; data: { position: number } }>(a: T, b: T) {
  return a.data.position - b.data.position || a.id.localeCompare(b.id);
}

/** Manual order of projects and labels: positioned records first, then those never moved. */
function byManualPosition(a: { data: { position?: number } }, b: { data: { position?: number } }) {
  const left = a.data.position;
  const right = b.data.position;
  if (left === undefined || right === undefined) return Number(left === undefined) - Number(right === undefined);
  return left - right;
}

export function compareProjects(a: Project, b: Project) {
  return byManualPosition(a, b) || Temporal.Instant.compare(a.data.createdAt, b.data.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Parent shown for a project. A missing parent, the Inbox, a parent with another archive state or a
 * cycle (possible after merging edits from two devices) leaves the project at the top level.
 */
export function projectParentId(projects: ReadonlyMap<string, Project>, project: Project): string | null {
  const seen = new Set([project.id]);
  let current = project;
  let parentId: string | null = null;
  for (;;) {
    const parent = current.data.parentId ? projects.get(current.data.parentId) : undefined;
    if (!parent || parent.isInbox || parent.data.archived !== current.data.archived) return parentId ?? null;
    if (seen.has(parent.id)) return null;
    parentId ??= parent.id;
    seen.add(parent.id);
    current = parent;
  }
}

/** Projects in tree order: each parent followed by its children, siblings in manual order. */
export function projectTreeOrder(projects: ReadonlyMap<string, Project>, selected: Project[]) {
  const children = new Map<string | null, Project[]>();
  for (const project of [...selected].sort(compareProjects)) {
    const parentId = projectParentId(projects, project);
    children.set(parentId, [...children.get(parentId) ?? [], project]);
  }
  const ordered: Project[] = [];
  const visit = (parentId: string | null) => {
    for (const project of children.get(parentId) ?? []) {
      ordered.push(project);
      visit(project.id);
    }
  };
  visit(null);
  return ordered;
}

/** True when `candidateId` is `project` itself or one of its descendants. */
export function isProjectInSubtree(projects: ReadonlyMap<string, Project>, project: Project, candidateId: string) {
  let current = projects.get(candidateId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.id === project.id) return true;
    seen.add(current.id);
    const parentId = projectParentId(projects, current);
    current = parentId ? projects.get(parentId) : undefined;
  }
  return false;
}

export function compareLabels(a: Label, b: Label) {
  return byManualPosition(a, b) || a.data.name.localeCompare(b.data.name, "pt-BR") || a.id.localeCompare(b.id);
}

export const isActive = (task: Task) => task.data.completedAt === null;
export const isOverdue = (task: Task, today: string) =>
  isActive(task) && task.data.dueDate !== null && task.data.dueDate < today;

export function sameGroup(left: TaskGroup, right: TaskGroup) {
  return left.projectId === right.projectId && left.sectionId === right.sectionId && left.parentId === right.parentId;
}

export function childrenByParent(tasks: Iterable<Task>) {
  const children = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const siblings = children.get(task.parentId);
    if (siblings) siblings.push(task);
    else children.set(task.parentId, [task]);
  }
  for (const siblings of children.values()) siblings.sort(byPosition);
  return children;
}

export function childrenOf(product: Product, id: string) {
  return [...product.tasks.values()].filter((task) => task.parentId === id).sort(byPosition);
}

export function taskDescendants(product: Product, id: string) {
  const children = childrenByParent(product.tasks.values());
  return walkTaskTree(children.get(id) ?? [], (task) => children.get(task.id) ?? []);
}

export function groupTasks(product: Product, group: TaskGroup) {
  return [...product.tasks.values()].filter((task) => sameGroup(task, group)).sort(byPosition);
}

export function orderedSections(product: Product, projectId: string) {
  return [...product.sections.values()].filter((section) => section.projectId === projectId).sort(byPosition);
}

export function orderedRoots(roots: Task[], mode: ProjectPayload["view"]["sortMode"]) {
  return [...roots].sort((a, b) => {
    if (mode === "priority") return a.data.priority - b.data.priority || byPosition(a, b);
    if (mode === "date") {
      const dateOrder = Number(a.data.dueDate === null) - Number(b.data.dueDate === null)
        || (a.data.dueDate ?? "").localeCompare(b.data.dueDate ?? "");
      const timeOrder = (a.data.dueTime ?? "24:00").localeCompare(b.data.dueTime ?? "24:00");
      return dateOrder || timeOrder || byPosition(a, b);
    }
    return byPosition(a, b);
  });
}

export function normalizeLabelName(name: string) {
  return name.trim().normalize("NFC").toLowerCase().normalize("NFC");
}

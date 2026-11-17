import type { LabelPayload, ProjectPayload, SectionPayload, TaskPayload } from "@/validation/product";

type RecordData<T> = { id: string; revision: number; data: T };
export type Project = RecordData<ProjectPayload> & { isInbox: boolean };
export type Section = RecordData<SectionPayload> & { projectId: string };
export type Label = RecordData<LabelPayload>;
export type TaskGroup = { projectId: string; sectionId: string | null; parentId: string | null };
export type Task = RecordData<TaskPayload> & TaskGroup & { occurrenceId: string | null };

export type Product = {
  projects: Map<string, Project>;
  sections: Map<string, Section>;
  tasks: Map<string, Task>;
  labels: Map<string, Label>;
  taskLabels: Map<string, string[]>;
  referenceDate: string;
};

export function byPosition<T extends { id: string; data: { position: number } }>(a: T, b: T) {
  return a.data.position - b.data.position || a.id.localeCompare(b.id);
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

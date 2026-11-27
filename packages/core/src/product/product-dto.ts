import {
  childrenByParent, childrenOf, compareLabels, projectParentId, isActive, isOverdue, orderedRoots, orderedSections,
  type Label, type Product, type Project, type Section, type Task, type TaskComment,
} from "../domain/product";
import { walkTaskTree } from "../domain/task-tree";
import { taskDescriptionExcerpt } from "../domain/task-description";

export function inboxProject(product: Pick<Product, "projects">) {
  const inbox = [...product.projects.values()].find((project) => project.isInbox);
  if (!inbox) throw new Error("Entrada indisponível.");
  return inbox;
}

export function visibleTask(product: Product, task: Task) {
  return isActive(task) && product.projects.get(task.projectId)?.data.archived === false;
}

export function projectCounts(product: Product, projectId: string) {
  let activeCount = 0;
  let completedCount = 0;
  for (const task of product.tasks.values()) {
    if (task.projectId !== projectId) continue;
    if (isActive(task)) activeCount++;
    else completedCount++;
  }
  return { activeCount, completedCount };
}

function projectSummaryWithCount(projects: ReadonlyMap<string, Project>, project: Project, activeCount: number) {
  return {
    id: project.id,
    revision: project.revision,
    name: project.data.name,
    defaultSectionName: project.data.defaultSectionName ?? null,
    parentId: projectParentId(projects, project),
    description: project.data.description,
    color: project.data.color,
    icon: project.data.icon,
    isInbox: project.isInbox,
    status: project.data.archived ? "archived" as const : "active" as const,
    activeCount: project.data.archived ? 0 : activeCount,
  };
}

export function projectSummary(product: Product, project: Project) {
  return projectSummaryWithCount(product.projects, project, project.data.archived ? 0 : projectCounts(product, project.id).activeCount);
}

export function projectSummaries(
  all: ReadonlyMap<string, Project>, projects: Project[], counts: ReadonlyMap<string, number>,
) {
  return projects.map((project) => projectSummaryWithCount(all, project, counts.get(project.id) ?? 0));
}

export function sectionDto(product: Product, section: Section, taskCount?: number) {
  taskCount ??= [...product.tasks.values()].filter((task) => task.sectionId === section.id).length;
  return { id: section.id, revision: section.revision, name: section.data.name, description: section.data.description, taskCount };
}

function labelSummary(label: Label, activeCount: number) {
  return { id: label.id, revision: label.revision, name: label.data.name, activeCount };
}

export function labelDto(product: Product, label: Label) {
  const activeCount = [...product.tasks.values()]
    .filter((task) => product.taskLabels.get(task.id)?.includes(label.id) && visibleTask(product, task)).length;
  return labelSummary(label, activeCount);
}

export function labelSummaries(labels: Iterable<Label>, counts: ReadonlyMap<string, number>) {
  return [...labels].sort(compareLabels).map((label) => labelSummary(label, counts.get(label.id) ?? 0));
}

function originFor(product: Product, task: Task) {
  const project = product.projects.get(task.projectId);
  if (!project) throw new Error("Projeto indisponível.");
  return {
    projectName: project.data.name,
    isInbox: project.isInbox,
    sectionName: task.sectionId ? product.sections.get(task.sectionId)?.data.name ?? null : null,
    parentTitle: task.parentId ? product.tasks.get(task.parentId)?.data.title ?? null : null,
  };
}

export function taskItem(
  product: Product, task: Task, options: { origin?: boolean; includeCompletedChildren?: boolean; children?: readonly Task[] } = {},
) {
  const { id, revision, projectId, sectionId, parentId, occurrenceId, data } = task;
  const children = options.children ?? childrenOf(product, task.id);
  const labelIds = product.taskLabels.get(id) ?? [];
  const labels = labelIds.flatMap((labelId) => product.labels.get(labelId) ?? []).sort(compareLabels)
    .map((label) => ({ id: label.id, name: label.data.name }));
  return {
    id, revision, projectId, sectionId, parentId, occurrenceId,
    title: data.title,
    descriptionExcerpt: taskDescriptionExcerpt(data.description),
    priority: data.priority,
    status: isActive(task) ? "active" as const : "completed" as const,
    completedAt: data.completedAt,
    dueDate: data.dueDate,
    dueTime: data.dueTime,
    overdue: isOverdue(task, product.referenceDate),
    recurrence: data.recurrenceRule ? { frequency: data.recurrenceRule.frequency } : null,
    recurrenceRule: data.recurrenceRule,
    childIds: children.filter((child) => options.includeCompletedChildren !== false || isActive(child))
      .map((child) => child.id),
    subtasks: { total: children.length, completed: children.filter((child) => !isActive(child)).length },
    labels,
    ...(options.origin ? { origin: originFor(product, task) } : {}),
  };
}

export function taskItemsWithOrigin(product: Product) {
  const children = childrenByParent(product.tasks.values());
  return (task: Task) => taskItem(product, task, { origin: true, children: children.get(task.id) ?? [] });
}

export function taskDetail(product: Product, task: Task) {
  const byParent = childrenByParent(product.tasks.values());
  const children = byParent.get(task.id) ?? [];
  return {
    ...taskItem(product, task, { children, origin: true }),
    description: task.data.description,
    createdAt: task.data.createdAt,
    children: children.map((child) => taskItem(product, child, { children: byParent.get(child.id) ?? [] })),
    commentCount: product.commentCounts.get(task.id) ?? 0,
  };
}

export function commentDto({ id, taskId, revision, data }: TaskComment) {
  return { id, taskId, revision, body: data.body, createdAt: data.createdAt, editedAt: data.editedAt };
}

export function projectPage(product: Product, project: Project, includeCompleted?: boolean) {
  const include = includeCompleted ?? project.data.view.showCompleted;
  const view = project.data.view;
  const sections = orderedSections(product, project.id);
  const projectTasks = [...product.tasks.values()].filter((task) => task.projectId === project.id);
  const children = childrenByParent(projectTasks);
  const rootsBySection = new Map<string | null, Task[]>();
  const sectionCounts = new Map<string, number>();
  for (const task of projectTasks) {
    if (task.sectionId) sectionCounts.set(task.sectionId, (sectionCounts.get(task.sectionId) ?? 0) + 1);
    if (task.parentId || (!include && !isActive(task))) continue;
    const roots = rootsBySection.get(task.sectionId);
    if (roots) roots.push(task);
    else rootsBySection.set(task.sectionId, [task]);
  }

  const items: ReturnType<typeof taskItem>[] = [];
  const visibleChildren = (task: Task) => {
    const direct = children.get(task.id) ?? [];
    return include ? direct : direct.filter(isActive);
  };
  const groups = [null, ...sections.map((section) => section.id)].map((sectionId) => {
    const sorted = orderedRoots(rootsBySection.get(sectionId) ?? [], view.sortMode);
    for (const { task } of walkTaskTree(sorted, visibleChildren)) {
      items.push(taskItem(product, task, { includeCompletedChildren: include, children: children.get(task.id) ?? [] }));
    }
    return { sectionId, rootIds: sorted.map((root) => root.id) };
  });
  // Project reads load only this project, so the hierarchy comes from navigation.
  const { parentId: _parentId, ...summary } = projectSummary(product, project);
  return {
    referenceDate: product.referenceDate,
    project: { ...summary, view },
    sections: sections.map((section) => sectionDto(product, section, sectionCounts.get(section.id) ?? 0)),
    groups,
    tasks: items,
  };
}

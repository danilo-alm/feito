import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { byPosition, childrenByParent, isActive } from "@/domain/product";
import { readExportSnapshot, type ProductAccess } from "@/server/db/product";
import { documentType, schemaVersion, type PortableDocument } from "./document";

function localIds<T>(values: readonly T[], key: (value: T) => string, prefix: string) {
  return new Map(values.map((value, index) => [key(value), `${prefix}${index + 1}`]));
}

const idOf = (record: { id: string }) => record.id;
const occurrenceKey = (taskId: string, occurrenceId: string) => `${taskId}/${occurrenceId}`;

export async function exportAccount(access: ProductAccess) {
  const { product, settings, occurrences } = await readExportSnapshot(access);
  const projects = [...product.projects.values()].sort((a, b) =>
    Number(b.isInbox) - Number(a.isInbox) || Temporal.Instant.compare(a.data.createdAt, b.data.createdAt)
    || a.id.localeCompare(b.id));
  const projectIds = localIds(projects, idOf, "p");
  const projectOrder = new Map(projects.map((project, index) => [project.id, index]));
  const sections = [...product.sections.values()].sort((a, b) =>
    projectOrder.get(a.projectId)! - projectOrder.get(b.projectId)! || byPosition(a, b));
  const sectionIds = localIds(sections, idOf, "s");
  const sectionOrder = new Map(sections.map((section, index) => [section.id, index]));
  const labels = [...product.labels.values()].sort((a, b) =>
    a.data.name.localeCompare(b.data.name, "pt-BR") || a.id.localeCompare(b.id));
  const labelIds = localIds(labels, idOf, "l");

  const children = childrenByParent(product.tasks.values());
  const tasks = [...product.tasks.values()].filter((task) => task.parentId === null).sort((a, b) =>
    projectOrder.get(a.projectId)! - projectOrder.get(b.projectId)!
    || (sectionOrder.get(a.sectionId ?? "") ?? -1) - (sectionOrder.get(b.sectionId ?? "") ?? -1)
    || byPosition(a, b)).flatMap((task) => [task, ...(children.get(task.id) ?? [])]);
  const taskIds = localIds(tasks, idOf, "t");
  const taskOrder = new Map(tasks.map((task, index) => [task.id, index]));
  const history = occurrences.sort((a, b) =>
    taskOrder.get(a.taskId)! - taskOrder.get(b.taskId)! || Temporal.Instant.compare(a.data.completedAt, b.data.completedAt)
    || a.occurrenceId.localeCompare(b.occurrenceId));
  const occurrenceIds = localIds([
    ...tasks.flatMap((task) => task.occurrenceId ? [occurrenceKey(task.id, task.occurrenceId)] : []),
    ...history.map((row) => occurrenceKey(row.taskId, row.occurrenceId)),
  ], (key) => key, "o");

  const document: PortableDocument = {
    type: documentType,
    schemaVersion,
    exportedAt: product.now.toString(),
    preferences: settings,
    projects: projects.map((project) => ({ id: projectIds.get(project.id)!, isInbox: project.isInbox, ...project.data })),
    sections: sections.map((section) => ({
      id: sectionIds.get(section.id)!, projectId: projectIds.get(section.projectId)!, ...section.data,
    })),
    tasks: tasks.map((task) => ({
      id: taskIds.get(task.id)!,
      projectId: projectIds.get(task.projectId)!,
      sectionId: task.sectionId ? sectionIds.get(task.sectionId)! : null,
      parentId: task.parentId ? taskIds.get(task.parentId)! : null,
      occurrenceId: task.occurrenceId ? occurrenceIds.get(occurrenceKey(task.id, task.occurrenceId))! : null,
      status: isActive(task) ? "active" : "completed",
      ...task.data,
    })),
    labels: labels.map((label) => ({ id: labelIds.get(label.id)!, ...label.data })),
    taskLabels: tasks.flatMap((task) => (product.taskLabels.get(task.id) ?? []).map((labelId) => ({
      taskId: taskIds.get(task.id)!, labelId: labelIds.get(labelId)!,
    })).sort((a, b) => a.labelId.localeCompare(b.labelId))),
    occurrences: history.map((row) => ({
      taskId: taskIds.get(row.taskId)!,
      occurrenceId: occurrenceIds.get(occurrenceKey(row.taskId, row.occurrenceId))!,
      ...row.data,
    })),
  };
  return { document, referenceDate: product.referenceDate };
}

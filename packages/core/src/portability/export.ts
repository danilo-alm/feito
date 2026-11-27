import { Temporal } from "@js-temporal/polyfill";
import {
  byPosition, childrenByParent, compareComments, isActive, type CompletedOccurrence, type Product, type TaskComment,
} from "../domain/product";
import { walkTaskTree } from "../domain/task-tree";
import type { Preferences } from "../types";
import { documentType, schemaVersion, type PortableDocument } from "./document";

function localIds<T>(values: readonly T[], key: (value: T) => string, prefix: string) {
  return new Map(values.map((value, index) => [key(value), `${prefix}${index + 1}`]));
}

const idOf = (record: { id: string }) => record.id;
const occurrenceKey = (taskId: string, occurrenceId: string) => `${taskId}/${occurrenceId}`;

export function exportDocument(
  product: Product, settings: Preferences, occurrences: readonly CompletedOccurrence[], comments: readonly TaskComment[] = [],
) {
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
  const roots = [...product.tasks.values()].filter((task) => task.parentId === null).sort((a, b) =>
    projectOrder.get(a.projectId)! - projectOrder.get(b.projectId)!
    || (sectionOrder.get(a.sectionId ?? "") ?? -1) - (sectionOrder.get(b.sectionId ?? "") ?? -1)
    || byPosition(a, b));
  const tasks = Array.from(walkTaskTree(roots, (task) => children.get(task.id) ?? []), ({ task }) => task);
  const taskIds = localIds(tasks, idOf, "t");
  const taskOrder = new Map(tasks.map((task, index) => [task.id, index]));
  const history = [...occurrences].sort((a, b) =>
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
    projects: projects.map(({ id, isInbox, data: { parentId, ...data } }) => ({
      id: projectIds.get(id)!, isInbox, ...data,
      // A parent missing from the export (never expected) leaves the project at the top level.
      ...parentId && projectIds.has(parentId) ? { parentId: projectIds.get(parentId)! } : {},
    })),
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
    occurrences: history.map(({ taskId, occurrenceId, data: { nominalDate, dueDate, dueTime, completedAt } }) => ({
      taskId: taskIds.get(taskId)!,
      occurrenceId: occurrenceIds.get(occurrenceKey(taskId, occurrenceId))!,
      nominalDate, dueDate, dueTime, completedAt,
    })),
    comments: comments.filter((comment) => taskIds.has(comment.taskId))
      .sort((a, b) => taskOrder.get(a.taskId)! - taskOrder.get(b.taskId)! || compareComments(a, b))
      .map(({ taskId, data: { body, createdAt, editedAt } }) => ({ taskId: taskIds.get(taskId)!, body, createdAt, editedAt })),
  };
  return { document, referenceDate: product.referenceDate };
}

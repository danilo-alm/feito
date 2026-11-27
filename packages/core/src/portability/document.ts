import { z } from "zod";
import { preferences } from "../validation/preferences";
import {
  civilDate, commentBody, defaultSectionName, description, instant, localTime, name, position, priority, projectColor, projectIcon, projectView, recurrenceRule, title,
} from "../validation/product";

export const documentType = "feito-data";
export const schemaVersion = 2;
const ref = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const portableDocument = z.strictObject({
  type: z.literal(documentType),
  schemaVersion: z.literal(schemaVersion),
  exportedAt: instant,
  preferences,
  projects: z.array(z.strictObject({
    id: ref, isInbox: z.boolean(), name, description,
    defaultSectionName,
    color: projectColor.nullable(), icon: projectIcon, archived: z.boolean(), view: projectView, createdAt: instant,
    position: position.optional(),
    parentId: ref.optional(),
  })),
  sections: z.array(z.strictObject({ id: ref, projectId: ref, name, description, position })),
  tasks: z.array(z.strictObject({
    id: ref, projectId: ref, sectionId: ref.nullable(), parentId: ref.nullable(),
    occurrenceId: ref.nullable(), title, description, priority, position, createdAt: instant,
    status: z.enum(["active", "completed"]), completedAt: instant.nullable(), dueDate: civilDate.nullable(),
    dueTime: localTime.nullable(), recurrenceRule: recurrenceRule.nullable(),
  })),
  labels: z.array(z.strictObject({ id: ref, name, position: position.optional() })),
  taskLabels: z.array(z.strictObject({ taskId: ref, labelId: ref })),
  occurrences: z.array(z.strictObject({
    occurrenceId: ref, taskId: ref, nominalDate: civilDate, dueDate: civilDate,
    dueTime: localTime.nullable(), completedAt: instant,
  })),
  comments: z.array(z.strictObject({
    taskId: ref, body: commentBody, createdAt: instant, editedAt: instant.nullable(),
  })),
});

export type PortableDocument = z.infer<typeof portableDocument>;
export type ImportIssue = { path: string; message: string };

export function countsFor(document: PortableDocument) {
  return {
    projects: document.projects.length,
    archivedProjects: document.projects.filter((project) => project.archived).length,
    sections: document.sections.length,
    tasks: document.tasks.length,
    completedTasks: document.tasks.filter((task) => task.status === "completed").length,
    labels: document.labels.length,
    occurrences: document.occurrences.length,
  };
}

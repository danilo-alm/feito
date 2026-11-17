import "server-only";
import { randomUUID } from "node:crypto";
import type { CompletedOccurrence, Label, Project, Section, Task } from "@/domain/product";
import type { PortableDocument } from "./document";

function mapIds(ids: string[], preserveOrder = false) {
  const generated = ids.map(() => randomUUID());
  if (preserveOrder) generated.sort();
  return new Map<string, string>(ids.map((id, index) => [id, generated[index]]));
}

export function remapForImport(document: PortableDocument, inboxId: string, inboxRevision: number) {
  const projectIds = mapIds(document.projects.filter((project) => !project.isInbox).map(({ id }) => id), true);
  projectIds.set(document.projects.find((project) => project.isInbox)!.id, inboxId);
  const sectionIds = mapIds(document.sections.map(({ id }) => id));
  const taskIds = mapIds(document.tasks.map(({ id }) => id));
  const labelIds = mapIds(document.labels.map(({ id }) => id));
  const occurrenceIds = mapIds([
    ...document.tasks.flatMap(({ occurrenceId }) => occurrenceId === null ? [] : [occurrenceId]),
    ...document.occurrences.map(({ occurrenceId }) => occurrenceId),
  ], true);

  return {
    projects: document.projects.map(({ id, isInbox, ...data }): Project => ({
      id: projectIds.get(id)!, isInbox, revision: isInbox ? inboxRevision + 1 : 1, data,
    })),
    sections: document.sections.map(({ id, projectId, ...data }): Section => ({
      id: sectionIds.get(id)!, projectId: projectIds.get(projectId)!, revision: 1, data,
    })),
    tasks: document.tasks.map(({ id, projectId, sectionId, parentId, occurrenceId, status: _status, ...data }): Task => ({
      id: taskIds.get(id)!, projectId: projectIds.get(projectId)!,
      sectionId: sectionId === null ? null : sectionIds.get(sectionId)!,
      parentId: parentId === null ? null : taskIds.get(parentId)!,
      occurrenceId: occurrenceId === null ? null : occurrenceIds.get(occurrenceId)!,
      revision: 1, data,
    })),
    labels: document.labels.map(({ id, ...data }): Label => ({
      id: labelIds.get(id)!, revision: 1, data,
    })),
    taskLabels: document.taskLabels.map(({ taskId, labelId }) => ({
      taskId: taskIds.get(taskId)!, labelId: labelIds.get(labelId)!,
    })),
    occurrences: document.occurrences.map(({ taskId, occurrenceId, ...data }): CompletedOccurrence => ({
      taskId: taskIds.get(taskId)!, occurrenceId: occurrenceIds.get(occurrenceId)!, data,
    })),
  };
}

import type { CompletedOccurrence, Label, Project, Section, Task, TaskComment } from "../domain/product";
import type { PortableDocument } from "./document";

function mapIds(ids: string[], allocateId: () => string, preserveOrder = false) {
  const generated = ids.map(() => allocateId());
  if (preserveOrder) generated.sort();
  return new Map<string, string>(ids.map((id, index) => [id, generated[index]]));
}

export function remapForImport(
  document: PortableDocument, inboxId: string, inboxRevision: number, allocateId: () => string,
) {
  const projectIds = mapIds(document.projects.filter((project) => !project.isInbox).map(({ id }) => id), allocateId, true);
  projectIds.set(document.projects.find((project) => project.isInbox)!.id, inboxId);
  const sectionIds = mapIds(document.sections.map(({ id }) => id), allocateId);
  const taskIds = mapIds(document.tasks.map(({ id }) => id), allocateId);
  const labelIds = mapIds(document.labels.map(({ id }) => id), allocateId);
  const occurrenceIds = mapIds([
    ...document.tasks.flatMap(({ occurrenceId }) => occurrenceId === null ? [] : [occurrenceId]),
    ...document.occurrences.map(({ occurrenceId }) => occurrenceId),
  ], allocateId, true);

  return {
    projects: document.projects.map(({ id, isInbox, parentId, ...data }): Project => ({
      id: projectIds.get(id)!, isInbox, revision: isInbox ? inboxRevision + 1 : 1,
      data: parentId === undefined ? data : { ...data, parentId: projectIds.get(parentId)! },
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
    comments: document.comments.map(({ taskId, ...data }): TaskComment => ({
      id: allocateId(), taskId: taskIds.get(taskId)!, revision: 1, data,
    })),
  };
}

import type { Product, Project, Task } from "../domain/product";
import { isActive } from "../domain/product";
import { ApiError, notFound } from "./errors";
import type { OrderAnchor } from "../types";

export function visibleRecord<T>(records: Map<string, T>, id: string) {
  const record = records.get(id);
  if (!record) throw notFound();
  return record;
}

export function requireRevision<T>(
  record: { revision: number }, expected: number, current: () => T,
) {
  if (record.revision !== expected) {
    throw new ApiError(409, "REVISION_CONFLICT", "O recurso foi atualizado. Recarregue e tente novamente.", {
      current: current(),
    });
  }
}

export function validation(field: string, message: string) {
  return new ApiError(422, "VALIDATION_FAILED", "Revise os campos enviados.", { fieldErrors: { [field]: message } });
}

export function writableProject(project: Project) {
  if (project.data.archived) {
    throw new ApiError(409, "PROJECT_ARCHIVED", "O projeto está arquivado.");
  }
  return project;
}

export function writableTask(task: Task) {
  if (!isActive(task)) throw new ApiError(409, "TASK_COMPLETED", "Reabra a tarefa antes de alterá-la.");
  return task;
}

export function protectInbox(project: Project) {
  if (project.isInbox) throw new ApiError(422, "INBOX_PROTECTED", "A Entrada é protegida.");
}

export function validateSection(product: Product, projectId: string, sectionId: string | null) {
  if (sectionId === null) return;
  const section = visibleRecord(product.sections, sectionId);
  if (section.projectId !== projectId) throw validation("sectionId", "A seção deve pertencer ao projeto de destino.");
}

export function labelSelection(product: Product, labelIds: string[]) {
  const unique = [...new Set(labelIds)];
  for (const id of unique) visibleRecord(product.labels, id);
  return unique;
}

export function nextRevision<T extends { id: string; revision: number }>(original: Map<string, T>, record: T): T {
  return { ...record, revision: (original.get(record.id)?.revision ?? 0) + 1 };
}

/**
 * Places `moved` among `siblings` (already ordered, without `moved`) and renumbers the positions.
 * Records whose position does not change keep their revision.
 */
export function placeInOrder<T extends { id: string; revision: number; data: { position?: number } }>(
  siblings: T[], moved: T, anchor: OrderAnchor, original: Map<string, T>, write: (record: T) => void,
) {
  const ordered = siblings.filter((sibling) => sibling.id !== moved.id);
  const anchorId = anchor.afterId ?? anchor.beforeId;
  let index = ordered.length;
  if (anchorId) {
    const at = ordered.findIndex((sibling) => sibling.id === anchorId);
    if (at < 0) throw new ApiError(422, "INVALID_ANCHOR", "Escolha outro item da mesma lista.");
    index = at + Number(Boolean(anchor.afterId));
  }
  ordered.splice(index, 0, moved);
  for (const [position, record] of ordered.entries()) {
    if (record.data.position !== position) write(nextRevision(original, { ...record, data: { ...record.data, position } }));
  }
  return ordered.map((record) => record.id);
}

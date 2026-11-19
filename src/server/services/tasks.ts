import "server-only";
import { randomUUID } from "node:crypto";
import { childrenOf, groupTasks, isActive, sameGroup, taskDescendants, type Product, type Task, type TaskGroup } from "@/domain/product";
import { nextOccurrenceDate } from "@/domain/recurrence";
import { taskAncestors } from "@/domain/task-tree";
import { mutateProduct, type ProductAccess } from "@/server/db/product";
import { readTaskDetail } from "@/server/db/product-reads";
import { ApiError } from "@/server/errors";
import {
  civilDate, type CompleteTaskInput, type CreateTaskInput, type EditTaskInput, type SetRecurrenceInput,
  type TaskMoveInput, type UndoTaskCompletionInput,
} from "@/validation/product";
import { inboxProject, taskDetail, taskItem } from "./product-dto";
import {
  labelSelection, nextRevision, requireRevision, validateSection, validation, visibleRecord, writableProject, writableTask,
} from "./product-rules";

function projectFor(product: Product, id: string) {
  return writableProject(visibleRecord(product.projects, id));
}

function parentFor(product: Product, id: string, projectId: string, taskId?: string) {
  const parent = visibleRecord(product.tasks, id);
  if (!isActive(parent) || parent.occurrenceId || parent.projectId !== projectId) {
    throw new ApiError(422, "INVALID_PARENT", "Escolha uma tarefa ativa e sem recorrência no projeto de destino.");
  }
  if (taskId) {
    if (parent.id === taskId) throw new ApiError(422, "INVALID_PARENT", "Uma tarefa não pode ser seu próprio pai.");
    for (const ancestor of taskAncestors(parent, product.tasks)) {
      if (ancestor.id === taskId) throw new ApiError(422, "INVALID_PARENT", "Uma tarefa não pode ficar abaixo de uma de suas subtarefas.");
    }
  }
  return parent;
}

function loadedTask(product: Product, id: string) {
  const task = visibleRecord(product.tasks, id);
  projectFor(product, task.projectId);
  return task;
}

function taskRevision(product: Product, task: Task, revision: number) {
  requireRevision(task, revision, () => taskDetail(product, task));
}

function validateSchedule(dueDate: string | null, dueTime: string | null) {
  if (dueTime !== null && dueDate === null) throw validation("dueTime", "Informe uma data para definir o horário.");
}

function notAllowedRecurrence() {
  return new ApiError(422, "RECURRENCE_NOT_ALLOWED", "A recorrência exige uma tarefa raiz sem filhos.");
}

function saveTask(product: Product, original: Product, task: Task) {
  const updated = nextRevision(original.tasks, task);
  product.tasks.set(updated.id, updated);
  return updated;
}

function reopenAncestors(product: Product, original: Product, task: Task) {
  let reopenedParentId: string | null = null;
  for (const parent of taskAncestors(task, product.tasks)) {
    if (isActive(parent)) break;
    saveTask(product, original, { ...parent, data: { ...parent.data, completedAt: null } });
    reopenedParentId ??= parent.id;
  }
  return reopenedParentId;
}

export function createTask(access: ProductAccess, input: CreateTaskInput) {
  const id = randomUUID();
  const occurrenceId = input.recurrence ? randomUUID() : null;
  return mutateProduct(access, (product, original) => {
    const suppliedParent = input.parentId ? visibleRecord(product.tasks, input.parentId) : null;
    const projectId = suppliedParent?.projectId ?? input.projectId ?? inboxProject(product).id;
    projectFor(product, projectId);
    const parent = suppliedParent ? parentFor(product, suppliedParent.id, projectId) : null;
    const sectionId = parent ? parent.sectionId : input.sectionId ?? null;
    validateSection(product, projectId, sectionId);
    if (parent && input.recurrence) throw notAllowedRecurrence();

    const anchorDate = input.recurrence?.anchorDate ?? input.dueDate ?? null;
    if (input.recurrence && anchorDate === null) {
      throw validation("recurrence", "Informe uma data de âncora ou de agendamento.");
    }
    const dueDate = input.dueDate ?? (input.recurrence ? anchorDate : null);
    const dueTime = input.dueTime === undefined ? input.recurrence?.time ?? null : input.dueTime;
    validateSchedule(dueDate, dueTime);
    const recurrenceRule = input.recurrence && anchorDate ? {
      frequency: input.recurrence.frequency,
      anchorDate,
      nominalDate: anchorDate,
      time: input.recurrence.time === undefined ? dueTime : input.recurrence.time,
    } : null;

    const group = { projectId, sectionId, parentId: parent?.id ?? null };
    const position = (groupTasks(product, group).at(-1)?.data.position ?? -1) + 1;
    const labelIds = labelSelection(product, input.labelIds ?? []);
    const task = saveTask(product, original, {
      ...group, id, revision: 1, occurrenceId,
      data: {
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? 4,
        createdAt: product.now.toString(),
        completedAt: null,
        dueDate, dueTime, position, recurrenceRule,
      },
    });
    if (labelIds.length) product.taskLabels.set(id, labelIds);
    return taskDetail(product, task);
  });
}

export async function getTask(access: ProductAccess, id: string) {
  const { product, task } = await readTaskDetail(access, id);
  return taskDetail(product, task);
}

export function editTask(access: ProductAccess, id: string, input: EditTaskInput) {
  const { revision, labelIds, recurrence, destination, ...fields } = input;
  const occurrence = recurrence && { ...recurrence, id: randomUUID() };
  return mutateProduct(access, (product, original) => {
    const current = writableTask(loadedTask(product, id));
    taskRevision(product, current, revision);
    const task = recurrence === null ? withoutRecurrence(current) : current;
    if (!occurrence && task.occurrenceId && fields.dueDate === null) {
      throw validation("dueDate", "Encerre a recorrência antes de remover a data.");
    }
    const dueDate = fields.dueDate === undefined ? task.data.dueDate : fields.dueDate;
    const dueTime = fields.dueTime === undefined ? (dueDate === null ? null : task.data.dueTime) : fields.dueTime;
    const edited = { ...task, data: { ...task.data, ...fields, dueDate, dueTime } };
    const scheduled = occurrence ? withRecurrence(product, edited, occurrence.id, occurrence) : edited;
    validateSchedule(scheduled.data.dueDate, scheduled.data.dueTime);
    if (labelIds !== undefined) {
      const labels = labelSelection(product, labelIds);
      if (labels.length) product.taskLabels.set(id, labels);
      else product.taskLabels.delete(id);
    }
    const saved = saveTask(product, original, scheduled);
    if (destination && (saved.parentId || !sameGroup(saved, { ...destination, parentId: null }))) {
      applyTaskMove(product, original, saved, { type: "root", ...destination });
    }
    return taskDetail(product, visibleRecord(product.tasks, id));
  });
}

function withRecurrence(
  product: Product, task: Task, occurrenceId: string, { anchorDate, frequency, time = null }: Omit<SetRecurrenceInput, "revision">,
): Task {
  if (task.parentId || childrenOf(product, task.id).length) throw notAllowedRecurrence();
  return {
    ...task,
    occurrenceId,
    data: {
      ...task.data, dueDate: anchorDate, dueTime: time,
      recurrenceRule: { frequency, anchorDate, nominalDate: anchorDate, time },
    },
  };
}

function withoutRecurrence(task: Task): Task {
  return { ...task, occurrenceId: null, data: { ...task.data, recurrenceRule: null } };
}

export function setRecurrence(access: ProductAccess, id: string, input: SetRecurrenceInput) {
  const occurrenceId = randomUUID();
  return mutateProduct(access, (product, original) => {
    const task = writableTask(loadedTask(product, id));
    taskRevision(product, task, input.revision);
    return taskDetail(product, saveTask(product, original, withRecurrence(product, task, occurrenceId, input)));
  });
}

export function removeRecurrence(access: ProductAccess, id: string, revision: number) {
  return mutateProduct(access, (product, original) => {
    const task = writableTask(loadedTask(product, id));
    taskRevision(product, task, revision);
    if (!task.occurrenceId) return taskDetail(product, task);
    return taskDetail(product, saveTask(product, original, withoutRecurrence(task)));
  });
}

export function completeTask(access: ProductAccess, id: string, input: CompleteTaskInput) {
  const nextId = randomUUID();
  const occurrence = input.occurrenceId ? { taskId: id, occurrenceId: input.occurrenceId } : undefined;
  return mutateProduct(access, (product, original, history) => {
    const task = visibleRecord(product.tasks, id);
    if (history.recorded) {
      return { task: taskItem(product, task), completedChildIds: [], alreadyProcessed: true };
    }

    projectFor(product, task.projectId);
    writableTask(task);
    if (occurrence && occurrence.occurrenceId !== task.occurrenceId) {
      throw new ApiError(409, "OCCURRENCE_STALE", "A ocorrência mudou. Atualize a tarefa e tente de novo.");
    }
    if (task.occurrenceId && !occurrence) {
      throw validation("occurrenceId", "Informe a ocorrência a concluir.");
    }
    taskRevision(product, task, input.revision);

    const completedAt = product.now.toString();
    if (occurrence) {
      const { recurrenceRule, dueDate, dueTime } = task.data;
      if (!recurrenceRule || !dueDate) throw new Error("Ocorrência sem agendamento.");
      const date = nextOccurrenceDate(recurrenceRule, dueDate, product.referenceDate);
      if (!civilDate.safeParse(date).success) throw validation("dueDate", "A próxima data excede o intervalo disponível.");
      history.completion = { ...occurrence, data: {
        nominalDate: recurrenceRule.nominalDate, dueDate, dueTime, completedAt, nextOccurrenceId: nextId,
      } };
      const updated = saveTask(product, original, {
        ...task,
        occurrenceId: nextId,
        data: {
          ...task.data, dueDate: date, dueTime: recurrenceRule.time,
          recurrenceRule: { ...recurrenceRule, nominalDate: date },
        },
      });
      return { task: taskItem(product, updated), completedChildIds: [], alreadyProcessed: false };
    }

    const activeChildren = Array.from(taskDescendants(product, id), ({ task }) => task).filter(isActive);
    if (activeChildren.length && !input.includeChildren) {
      throw new ApiError(409, "HAS_ACTIVE_CHILDREN", "Confirme a conclusão das subtarefas ativas.", {
        activeChildCount: activeChildren.length,
      });
    }
    for (const child of activeChildren) {
      saveTask(product, original, { ...child, data: { ...child.data, completedAt } });
    }
    const updated = saveTask(product, original, { ...task, data: { ...task.data, completedAt } });
    return {
      task: taskItem(product, updated),
      completedChildIds: activeChildren.map((child) => child.id),
      alreadyProcessed: false,
    };
  }, occurrence);
}

export function reopenTask(access: ProductAccess, id: string, revision: number) {
  return mutateProduct(access, (product, original) => {
    const task = loadedTask(product, id);
    taskRevision(product, task, revision);
    if (task.occurrenceId || isActive(task)) throw validation("revision", "Só tarefas avulsas concluídas podem ser reabertas.");
    const reopenedParentId = reopenAncestors(product, original, task);
    const updated = saveTask(product, original, { ...task, data: { ...task.data, completedAt: null } });
    return { task: taskItem(product, updated), reopenedParentId };
  });
}

export function undoTaskCompletion(access: ProductAccess, id: string, input: UndoTaskCompletionInput) {
  const occurrence = input.occurrenceId ? { taskId: id, occurrenceId: input.occurrenceId } : undefined;
  return mutateProduct(access, (product, original, history) => {
    const task = loadedTask(product, id);
    taskRevision(product, task, input.revision);

    if (occurrence) {
      const previous = history.previousCompletion;
      if (!history.recorded || !previous || !task.occurrenceId || !task.data.recurrenceRule
        || previous.data.nextOccurrenceId !== task.occurrenceId || task.data.dueDate === null) {
        throw new ApiError(409, "UNDO_UNAVAILABLE", "Esta conclusão recorrente não pode mais ser desfeita.");
      }
      const restored = saveTask(product, original, {
        ...task,
        occurrenceId: previous.occurrenceId,
        data: {
          ...task.data,
          dueDate: previous.data.dueDate,
          dueTime: previous.data.dueTime,
          recurrenceRule: { ...task.data.recurrenceRule, nominalDate: previous.data.nominalDate },
        },
      });
      return { task: taskItem(product, restored), reopenedChildIds: [], reopenedParentId: null };
    }

    if (task.occurrenceId || isActive(task)) {
      throw new ApiError(409, "UNDO_UNAVAILABLE", "Esta conclusão não pode mais ser desfeita.");
    }

    const selected = new Set(input.completedChildIds);
    const toReopen = input.completedChildIds.map((childId) => visibleRecord(product.tasks, childId));
    for (const child of toReopen) {
      if (child.id === task.id || !child.parentId || child.data.completedAt !== task.data.completedAt
        || (child.parentId !== task.id && !selected.has(child.parentId))) {
        throw new ApiError(409, "UNDO_UNAVAILABLE", "Uma subtarefa mudou desde a conclusão.");
      }
    }
    for (const child of toReopen) {
      saveTask(product, original, { ...child, data: { ...child.data, completedAt: null } });
    }

    const reopenedParentId = reopenAncestors(product, original, task);
    const reopened = saveTask(product, original, { ...task, data: { ...task.data, completedAt: null } });
    return {
      task: taskItem(product, reopened), reopenedChildIds: input.completedChildIds, reopenedParentId,
    };
  }, occurrence, occurrence ? { removeOccurrence: occurrence } : {});
}

export function deleteTask(access: ProductAccess, id: string, revision: number, withChildren?: boolean) {
  return mutateProduct(access, (product) => {
    const task = loadedTask(product, id);
    taskRevision(product, task, revision);
    const children = Array.from(taskDescendants(product, id), ({ task }) => task);
    if (children.length && !withChildren) {
      throw new ApiError(409, "HAS_CHILDREN", "Confirme a exclusão das subtarefas.", { childCount: children.length });
    }
    for (const removed of [...children, task]) {
      product.tasks.delete(removed.id);
      product.taskLabels.delete(removed.id);
    }
  });
}

function orderTasks(product: Product, original: Product, order: Task[]) {
  for (const [position, task] of order.entries()) {
    if (task !== product.tasks.get(task.id) || task.data.position !== position) {
      saveTask(product, original, { ...task, data: { ...task.data, position } });
    }
  }
}

type MoveTarget = TaskMoveInput["target"] | { type: "root"; projectId: string; sectionId: string | null };

function moveDestination(product: Product, task: Task, target: MoveTarget) {
  if (target.type === "promote") {
    if (!task.parentId) throw validation("target", "Escolha uma subtarefa para promover.");
    const parent = visibleRecord(product.tasks, task.parentId);
    const group: TaskGroup = { projectId: parent.projectId, sectionId: parent.sectionId, parentId: parent.parentId };
    return { group, anchor: parent, after: true };
  }

  const destination = projectFor(product, target.projectId);
  if (target.type === "root") {
    validateSection(product, destination.id, target.sectionId);
    return {
      group: { projectId: destination.id, sectionId: target.sectionId, parentId: null },
      anchor: null, after: false,
    };
  }
  const anchorId = target.beforeId ?? target.afterId;
  const anchor = anchorId ? visibleRecord(product.tasks, anchorId) : null;
  if (anchor && destination.data.view.sortMode !== "manual") {
    throw new ApiError(409, "SORT_NOT_MANUAL", "Use a ordenação manual para inserir entre tarefas.");
  }
  const parent = target.parentId ? parentFor(product, target.parentId, destination.id, task.id) : null;
  if (target.sectionId !== null) visibleRecord(product.sections, target.sectionId);
  const group: TaskGroup = {
    projectId: destination.id,
    sectionId: parent ? parent.sectionId : target.sectionId,
    parentId: parent?.id ?? null,
  };
  validateSection(product, group.projectId, group.sectionId);
  if (anchor && (anchor.id === task.id || !sameGroup(anchor, group))) {
    throw new ApiError(422, "INVALID_ANCHOR", "Escolha outra tarefa do grupo de destino.");
  }
  if (parent && task.occurrenceId) throw notAllowedRecurrence();
  if (task.parentId && (task.projectId !== group.projectId || (parent && task.sectionId !== group.sectionId))) {
    throw new ApiError(422, "MUST_PROMOTE_FIRST", "Transforme a subtarefa em tarefa principal antes de movê-la para esse destino.");
  }
  return { group, anchor, after: !!target.afterId };
}

function applyTaskMove(product: Product, original: Product, task: Task, target: MoveTarget) {
  const { group, anchor, after } = moveDestination(product, task, target);
  const source: TaskGroup = { projectId: task.projectId, sectionId: task.sectionId, parentId: task.parentId };
  const destination = groupTasks(product, group).filter((sibling) => sibling.id !== task.id);
  const index = anchor ? destination.findIndex((sibling) => sibling.id === anchor.id) + Number(after) : destination.length;
  destination.splice(index, 0, { ...task, ...group });

  const groups = [];
  if (!sameGroup(source, group)) {
    const previous = groupTasks(product, source).filter((sibling) => sibling.id !== task.id);
    orderTasks(product, original, previous);
    groups.push({ ...source, orderedIds: previous.map((sibling) => sibling.id) });
  }
  orderTasks(product, original, destination);
  if (task.projectId !== group.projectId || task.sectionId !== group.sectionId) {
    for (const { task: child } of taskDescendants(product, task.id)) {
      saveTask(product, original, { ...child, projectId: group.projectId, sectionId: group.sectionId });
    }
  }
  groups.push({ ...group, orderedIds: destination.map((sibling) => sibling.id) });
  return groups;
}

export function moveTask(access: ProductAccess, id: string, input: TaskMoveInput) {
  return mutateProduct(access, (product, original) => {
    const task = writableTask(loadedTask(product, id));
    taskRevision(product, task, input.revision);
    const groups = applyTaskMove(product, original, task, input.target);
    return { task: taskItem(product, visibleRecord(product.tasks, id)), groups };
  });
}

// Regras de organização de um projeto no cliente: soltura de arraste, comandos de teclado/menu
// e aplicação otimista. Espelham as validações de POST /tasks/{id}/move (docs/02, seção 3.6).
import type { Layout, MoveTarget, PositionTarget, ProjectPage, TaskItem } from "./types";
import { taskAncestors, walkTaskTree } from "@/domain/task-tree";

export const maxOverviewDepth = 5;

export type Zone = "before" | "after" | "center";
export type DropOver =
  | { kind: "task"; id: string; zone: Zone }
  | { kind: "group"; sectionId: string | null };

export type Indicator =
  | { type: "line"; id: string; side: "before" | "after"; depth: number }
  | { type: "nest"; id: string; previewAfterId: string; depth: number }
  | { type: "group"; sectionId: string | null }
  | { type: "invalid"; id: string; message: string };

export type MovePlan = { valid: true; steps: MoveTarget[]; indicator: Indicator; message: string };
export type InvalidPlan = { valid: false; indicator: Indicator; message: string };
export type Plan = MovePlan | InvalidPlan;

export function taskMap(page: ProjectPage) {
  return new Map(page.tasks.map((task) => [task.id, task]));
}

export function sectionName(page: ProjectPage, sectionId: string | null) {
  if (sectionId === null) return page.project.isInbox ? page.project.name : "Sem seção";
  return page.sections.find((section) => section.id === sectionId)?.name ?? "Seção";
}

function rootIds(page: ProjectPage, sectionId: string | null) {
  return page.groups.find((group) => group.sectionId === sectionId)?.rootIds ?? [];
}

/** Irmãos ativos na ordem exibida (mesma seção e mesmo pai). */
export function activeSiblings(page: ProjectPage, task: TaskItem, tasks = taskMap(page)) {
  const ids = task.parentId ? tasks.get(task.parentId)?.childIds ?? [] : rootIds(page, task.sectionId);
  return ids.map((id) => tasks.get(id)).filter((item): item is TaskItem => !!item && item.status === "active");
}

export function taskBranch<T extends { childIds: string[] }>(task: T, tasks: ReadonlyMap<string, T>, maxDepth?: number) {
  return walkTaskTree([task], (item) => item.childIds.flatMap((id) => tasks.get(id) ?? []), maxDepth);
}

/** Última linha visível de um ramo. */
function blockEnd(task: TaskItem, tasks: Map<string, TaskItem>, depth: number) {
  let last = task;
  for (let level = depth; level < maxOverviewDepth; level++) {
    const childId = last.childIds.findLast((id) => tasks.has(id));
    if (!childId) break;
    last = tasks.get(childId)!;
  }
  return last.id;
}

const invalid = (message: string, indicator: Indicator): InvalidPlan => ({ valid: false, message, indicator });

function nestPlan(page: ProjectPage, active: TaskItem, target: TaskItem, tasks: Map<string, TaskItem>): Plan | null {
  const mark = (message: string) => invalid(message, { type: "invalid", id: target.id, message });
  if (active.parentId === target.id) return null;
  if (target.status !== "active") return mark("Reabra a tarefa antes");
  if (active.recurrence) return mark("Tarefa recorrente não vira subtarefa");
  if (target.recurrence) return mark("Tarefa recorrente não recebe subtarefas");
  const depth = Array.from(taskAncestors(target, tasks)).length;
  return {
    valid: true,
    steps: [{ type: "position", projectId: page.project.id, sectionId: target.sectionId, parentId: target.id }],
    indicator: { type: "nest", id: target.id, previewAfterId: blockEnd(target, tasks, depth), depth: depth + 1 },
    message: `“${active.title}” agora é subtarefa de “${target.title}”`,
  };
}

function wouldChange(page: ProjectPage, active: TaskItem, target: PositionTarget, tasks: Map<string, TaskItem>) {
  if (active.parentId !== target.parentId || active.sectionId !== target.sectionId) return true;
  const ids = (target.parentId ? tasks.get(target.parentId)?.childIds : rootIds(page, target.sectionId)) ?? [];
  const without = ids.filter((id) => id !== active.id);
  const anchor = target.beforeId ?? target.afterId;
  const index = anchor ? without.indexOf(anchor) + (target.afterId ? 1 : 0) : without.length;
  without.splice(index, 0, active.id);
  return without.join() !== ids.join();
}

/**
 * Decide o que acontece ao soltar `activeId` sobre `over`.
 * Retorna `null` quando a soltura não muda nada.
 */
export function resolveDrop(page: ProjectPage, activeId: string, over: DropOver, layout: Layout): Plan | null {
  const tasks = taskMap(page);
  const active = tasks.get(activeId);
  if (!active) return null;
  if (active.status !== "active") {
    return invalid("Reabra a tarefa para mover", { type: "invalid", id: active.id, message: "Reabra para mover" });
  }
  const manual = page.project.view.sortMode === "manual";
  const projectId = page.project.id;

  if (over.kind === "group") {
    const { sectionId } = over;
    const target: PositionTarget = { type: "position", projectId, sectionId, parentId: null };
    if (!wouldChange(page, active, target, tasks)) return null;
    if (!active.parentId && active.sectionId === sectionId && !manual) return null;
    const name = sectionName(page, sectionId);
    return {
      valid: true, steps: [target], indicator: { type: "group", sectionId },
      message: active.sectionId === sectionId ? `Movida para o fim de ${name}` : `Movida para ${name}`,
    };
  }

  const target = tasks.get(over.id);
  if (!target || target.id === active.id) return null;
  const ancestors = Array.from(taskAncestors(target, tasks));
  if (ancestors.some((ancestor) => ancestor.id === active.id)) {
    const message = "Uma tarefa não pode ficar abaixo de suas subtarefas";
    return invalid(message, { type: "invalid", id: target.id, message });
  }
  const changesSection = target.sectionId !== active.sectionId;
  // O centro de uma tarefa de outra seção também aceita a subtarefa como raiz.
  if (active.parentId && changesSection && over.zone === "center") {
    return resolveDrop(page, activeId, { kind: "group", sectionId: target.sectionId }, layout);
  }
  if (over.zone === "center") return nestPlan(page, active, target, tasks);

  if (!manual) {
    // Sem âncora: só mudança de coluna no Painel continua disponível.
    if (layout === "board" && changesSection) {
      return resolveDrop(page, activeId, { kind: "group", sectionId: target.sectionId }, layout);
    }
    return null;
  }

  if (target.status !== "active") return null;
  const side = over.zone === "before" ? "before" : "after";

  if (target.parentId) {
    if (active.parentId === target.parentId) {
      const step: PositionTarget = {
        type: "position", projectId, sectionId: target.sectionId, parentId: target.parentId,
        ...(side === "before" ? { beforeId: target.id } : { afterId: target.id }),
      };
      if (!wouldChange(page, active, step, tasks)) return null;
      return {
        valid: true, steps: [step],
        indicator: { type: "line", id: side === "after" ? blockEnd(target, tasks, ancestors.length) : target.id, side, depth: ancestors.length },
        message: "Nova posição salva",
      };
    }
    // Sobre o bloco de outra raiz: entra como raiz logo depois desse bloco.
    const root = ancestors.at(-1);
    return root ? rootPlan(page, active, root, "after", tasks) : null;
  }
  return rootPlan(page, active, target, side, tasks);
}

function rootPlan(page: ProjectPage, active: TaskItem, target: TaskItem, side: "before" | "after", tasks: Map<string, TaskItem>): Plan | null {
  const step: PositionTarget = {
    type: "position", projectId: page.project.id, sectionId: target.sectionId, parentId: null,
    ...(side === "before" ? { beforeId: target.id } : { afterId: target.id }),
  };
  if (!wouldChange(page, active, step, tasks)) return null;
  const lineId = side === "after" ? blockEnd(target, tasks, 0) : target.id;
  const name = sectionName(page, target.sectionId);
  return {
    valid: true,
    steps: [step],
    indicator: { type: "line", id: lineId, side, depth: 0 },
    message: active.sectionId !== target.sectionId ? `Movida para ${name}`
      : active.parentId ? "Promovida a tarefa" : `Nova posição salva em ${name}`,
  };
}

export type KeyAction = "up" | "down" | "nest" | "promote" | "left" | "right";

/** Comandos de teclado e de menu (Alt+setas). */
export function keyboardPlan(page: ProjectPage, taskId: string, action: KeyAction, tasks = taskMap(page)): Plan | null {
  const task = tasks.get(taskId);
  if (!task) return null;
  const fail = (message: string) => invalid(message, { type: "invalid", id: task.id, message });
  if (task.status !== "active") return fail("Reabra a tarefa para mover");
  const manual = page.project.view.sortMode === "manual";
  const siblings = activeSiblings(page, task, tasks);
  const index = siblings.findIndex((item) => item.id === task.id);

  if (action === "up" || action === "down") {
    if (!manual) return fail("Reordenar só funciona na ordenação Manual");
    const neighbor = siblings[action === "up" ? index - 1 : index + 1];
    if (!neighbor) return null;
    const step: PositionTarget = {
      type: "position", projectId: page.project.id, sectionId: task.sectionId, parentId: task.parentId,
      ...(action === "up" ? { beforeId: neighbor.id } : { afterId: neighbor.id }),
    };
    const depth = Array.from(taskAncestors(task, tasks)).length;
    const side = action === "up" ? "before" : "after";
    const id = side === "after" ? blockEnd(neighbor, tasks, depth) : neighbor.id;
    return { valid: true, steps: [step], indicator: { type: "line", id, side, depth }, message: "Nova posição salva" };
  }
  if (action === "nest") {
    const previous = siblings[index - 1];
    if (!previous) return fail("Não há tarefa acima para receber a subtarefa");
    return nestPlan(page, task, previous, tasks);
  }
  if (action === "promote") {
    const parent = task.parentId ? tasks.get(task.parentId) : undefined;
    if (!parent) return null;
    const depth = Array.from(taskAncestors(parent, tasks)).length;
    return {
      valid: true, steps: [{ type: "promote" }],
      indicator: { type: "line", id: blockEnd(parent, tasks, depth), side: "after", depth },
      message: depth ? "Subtarefa movida um nível acima" : "Promovida a tarefa",
    };
  }
  // Painel: coluna vizinha.
  const order = page.groups.map((group) => group.sectionId);
  const next = order[order.indexOf(task.sectionId) + (action === "left" ? -1 : 1)];
  if (next === undefined) return null;
  return resolveDrop(page, task.id, { kind: "group", sectionId: next }, "board");
}

/** Itens do menu “⋯” de uma tarefa num projeto. */
export function menuActions(page: ProjectPage, taskId: string, tasks = taskMap(page)) {
  const actions: { action: "up" | "down" | "nest" | "promote"; label: string; key: string }[] = [];
  const order: ["up" | "down" | "nest" | "promote", string, string][] = [
    ["up", "Mover para cima", "Alt ↑"], ["down", "Mover para baixo", "Alt ↓"],
    ["nest", "Tornar subtarefa da anterior", "Alt →"], ["promote", "Promover a tarefa", "Alt ←"],
  ];
  for (const [action, label, key] of order) {
    const plan = keyboardPlan(page, taskId, action, tasks);
    if (plan?.valid) actions.push({ action, label, key });
  }
  return actions;
}

// ---------- Aplicação otimista ----------

function clonePage(page: ProjectPage): ProjectPage {
  return {
    ...page,
    groups: page.groups.map((group) => ({ ...group, rootIds: [...group.rootIds] })),
    tasks: page.tasks.map((task) => ({ ...task, childIds: [...task.childIds] })),
  };
}

function insert(ids: string[], id: string, anchor: { beforeId?: string; afterId?: string }) {
  const without = ids.filter((item) => item !== id);
  const anchorId = anchor.beforeId ?? anchor.afterId;
  const at = anchorId && without.includes(anchorId) ? without.indexOf(anchorId) + (anchor.afterId ? 1 : 0) : without.length;
  without.splice(at, 0, id);
  return without;
}

/** Aplica um passo de movimento localmente para dar retorno imediato; o servidor confirma depois. */
export function applyStep(source: ProjectPage, taskId: string, step: MoveTarget): ProjectPage {
  const page = clonePage(source);
  const tasks = taskMap(page);
  const task = tasks.get(taskId);
  if (!task) return source;

  const detach = () => {
    if (task.parentId) {
      const parent = tasks.get(task.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter((id) => id !== task.id);
        parent.subtasks = { ...parent.subtasks, total: Math.max(0, parent.subtasks.total - 1) };
      }
    } else {
      const group = page.groups.find((item) => item.sectionId === task.sectionId);
      if (group) group.rootIds = group.rootIds.filter((id) => id !== task.id);
    }
  };
  if (step.type === "promote") {
    const parent = task.parentId ? tasks.get(task.parentId) : undefined;
    if (!parent) return source;
    step = { type: "position", projectId: task.projectId, sectionId: task.sectionId, parentId: parent.parentId, afterId: parent.id };
  }

  const branch = Array.from(taskBranch(task, tasks), ({ task }) => task);
  if (step.projectId !== page.project.id) {
    const removed = new Set(branch.map((item) => item.id));
    detach();
    page.tasks = page.tasks.filter((item) => !removed.has(item.id));
    return page;
  }

  const parent = step.parentId ? tasks.get(step.parentId) : undefined;
  if (step.parentId && (!parent || branch.includes(parent))) return source;
  detach();
  task.parentId = parent?.id ?? null;
  const destination = parent ? parent.sectionId : step.sectionId;
  for (const item of branch) item.sectionId = destination;
  if (parent) {
    parent.childIds = insert(parent.childIds, task.id, step);
    parent.subtasks = { ...parent.subtasks, total: parent.subtasks.total + 1 };
  } else {
    const group = page.groups.find((item) => item.sectionId === step.sectionId);
    if (group) group.rootIds = insert(group.rootIds, task.id, step);
  }
  return page;
}

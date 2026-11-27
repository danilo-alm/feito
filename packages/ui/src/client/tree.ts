import { translate as t } from "./locale";
// Regras de organização de um projeto no cliente: destino do arraste, comandos de teclado/menu
// e aplicação otimista. Espelham as validações de POST /tasks/{id}/move (docs/02, seção 3.6).
import type { MoveTarget, PositionTarget, ProjectPage, TaskItem } from "@feito/core/types";
import { taskAncestors, walkTaskTree } from "@feito/core/domain/task-tree";

export const maxOverviewDepth = 5;
export const unnamedColumnTitle = "(Nenhuma seção)";

export type Indicator =
  | { type: "slot"; sectionId: string | null; afterId: string | null; depth: number }
  | { type: "line"; id: string; side: "before" | "after"; depth: number }
  | { type: "nest"; id: string; depth: number }
  | { type: "group"; sectionId: string | null }
  | { type: "invalid"; id: string; message: string };

export type MovePlan = { valid: true; steps: MoveTarget[]; indicator: Indicator; message: string };
export type InvalidPlan = { valid: false; indicator: Indicator; message: string };
export type Plan = MovePlan | InvalidPlan;

export function taskMap(page: ProjectPage) {
  return new Map(page.tasks.map((task) => [task.id, task]));
}

export function sectionName(page: ProjectPage, sectionId: string | null) {
  if (sectionId === null) return page.project.isInbox ? t("Entrada") : page.project.defaultSectionName ?? t("Sem seção");
  return page.sections.find((section) => section.id === sectionId)?.name ?? t("Seção");
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
  if (target.status !== "active") return mark(t("Reabra a tarefa antes"));
  if (active.recurrence) return mark(t("Tarefa recorrente não vira subtarefa"));
  if (target.recurrence) return mark(t("Tarefa recorrente não recebe subtarefas"));
  const depth = Array.from(taskAncestors(target, tasks)).length;
  return {
    valid: true,
    steps: [{ type: "position", projectId: page.project.id, sectionId: target.sectionId, parentId: target.id }],
    indicator: { type: "nest", id: target.id, depth: depth + 1 },
    message: t("“{0}” agora é subtarefa de “{1}”", [active.title, target.title]),
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

/** Leva a tarefa para o fim das raízes de uma seção (de outra, ou da mesma, para uma subtarefa). */
export function groupPlan(page: ProjectPage, activeId: string, sectionId: string | null): Plan | null {
  const tasks = taskMap(page);
  const active = tasks.get(activeId);
  if (!active) return null;
  if (active.status !== "active") {
    return invalid(t("Reabra a tarefa para mover"), { type: "invalid", id: active.id, message: t("Reabra para mover") });
  }
  const target: PositionTarget = { type: "position", projectId: page.project.id, sectionId, parentId: null };
  if (!wouldChange(page, active, target, tasks)) return null;
  if (!active.parentId && active.sectionId === sectionId && page.project.view.sortMode !== "manual") return null;
  const name = sectionName(page, sectionId);
  return {
    valid: true, steps: [target], indicator: { type: "group", sectionId },
    message: active.sectionId === sectionId ? t("Movida para o fim de {0}", [name]) : t("Movida para {0}", [name]),
  };
}

/** Linha visível de uma seção durante o arraste, na ordem da tela. */
export type SlotRow = { id: string; depth: number };
/** Onde a tarefa arrastada cairia: logo depois de `afterId` (ou no topo da seção), no nível `depth`. */
export type Slot = { sectionId: string | null; afterId: string | null; depth: number };

/** Linhas visíveis das tarefas abertas da seção, como na Lista e no Painel, sem o ramo de `activeId`. */
export function slotRows(page: ProjectPage, sectionId: string | null, activeId: string, tasks = taskMap(page)): SlotRow[] {
  const rows: SlotRow[] = [];
  const visit = (task: TaskItem, depth: number) => {
    if (task.id === activeId) return;
    rows.push({ id: task.id, depth });
    if (depth >= maxOverviewDepth) return;
    for (const id of task.childIds) {
      const child = tasks.get(id);
      if (child) visit(child, depth + 1);
    }
  };
  for (const id of rootIds(page, sectionId)) {
    const task = tasks.get(id);
    if (task?.status === "active") visit(task, 0);
  }
  return rows;
}

/** Lugar de origem da tarefa arrastada: a seção, a posição entre as linhas que continuam visíveis e o nível. */
export function originSlot(page: ProjectPage, activeId: string, tasks = taskMap(page)) {
  const active = tasks.get(activeId);
  if (!active) return null;
  const parentId = active.parentId && tasks.has(active.parentId) ? active.parentId : null;
  const rows = slotRows(page, active.sectionId, activeId, tasks);
  // Antes do próximo irmão visível; sem ele, depois do último descendente visível do pai (ou no fim da seção).
  const siblings = parentId ? tasks.get(parentId)!.childIds : rootIds(page, active.sectionId);
  const next = siblings.slice(siblings.indexOf(active.id) + 1).find((id) => rows.some((row) => row.id === id));
  let index = next ? rows.findIndex((row) => row.id === next) : rows.length;
  if (!next && parentId) {
    const parentIndex = rows.findIndex((row) => row.id === parentId);
    const parentDepth = rows[parentIndex]?.depth ?? 0;
    index = parentIndex + 1;
    while (index < rows.length && rows[index].depth > parentDepth) index++;
  }
  const depth = Math.min(Array.from(taskAncestors(active, tasks)).length, maxOverviewDepth);
  return { sectionId: active.sectionId, index, depth };
}

/**
 * Decide o que acontece ao soltar `activeId` na posição `index` das linhas visíveis da seção (`slotRows`),
 * no nível pedido pelo deslocamento horizontal (`wanted`). O nível fica entre o da linha de baixo e um abaixo
 * do da linha de cima; quando o pedido não é permitido (tarefa recorrente, pai concluído), sobe até um nível válido.
 * Retorna o lugar a mostrar e o plano (`null` quando a soltura não muda nada).
 */
export function resolveSlot(
  page: ProjectPage, activeId: string, sectionId: string | null, index: number, wanted: number,
): { slot: Slot; plan: Plan | null } | null {
  const tasks = taskMap(page);
  const active = tasks.get(activeId);
  if (!active) return null;
  const rows = slotRows(page, sectionId, activeId, tasks);
  index = Math.max(0, Math.min(index, rows.length));
  const prev = rows[index - 1];
  const next = rows[index];
  const max = Math.min(prev ? prev.depth + 1 : 0, maxOverviewDepth);
  const min = Math.min(next?.depth ?? 0, max);
  const parentAt = (depth: number) => {
    if (!depth) return null;
    for (let at = index - 1; at >= 0; at--) if (rows[at].depth === depth - 1) return tasks.get(rows[at].id) ?? null;
    return null;
  };
  const refusal = (depth: number) => {
    const parent = parentAt(depth);
    if (!parent) return null;
    if (parent.status !== "active") return t("Reabra a tarefa antes");
    if (active.recurrence) return t("Tarefa recorrente não vira subtarefa");
    if (parent.recurrence) return t("Tarefa recorrente não recebe subtarefas");
    // Uma subtarefa só troca de seção como tarefa principal (MUST_PROMOTE_FIRST).
    if (active.parentId && parent.sectionId !== active.sectionId) {
      return t("Transforme a subtarefa em tarefa principal antes de movê-la para esse destino.");
    }
    return null;
  };

  let depth = Math.max(min, Math.min(max, wanted));
  while (depth > min && refusal(depth)) depth--;
  const slot: Slot = { sectionId, afterId: prev?.id ?? null, depth };
  const fail = (message: string) => ({ slot, plan: invalid(message, { type: "invalid", id: active.id, message }) });
  if (active.status !== "active") return fail(t("Reabra a tarefa para mover"));
  const refused = refusal(depth);
  if (refused) return fail(refused);
  const parent = parentAt(depth);

  if (page.project.view.sortMode !== "manual") {
    // Sem âncora, a posição segue a ordenação: o espaço fica na origem e só a seção ou o pai mudam.
    if (!parent) {
      const origin = originSlot(page, activeId, tasks)!;
      const there = slotRows(page, origin.sectionId, activeId, tasks);
      return {
        slot: { sectionId: origin.sectionId, afterId: there[origin.index - 1]?.id ?? null, depth: origin.depth },
        plan: groupPlan(page, activeId, sectionId),
      };
    }
    return { slot, plan: active.parentId === parent.id ? null : nestPlan(page, active, parent, tasks) };
  }

  const step: PositionTarget = {
    type: "position", projectId: page.project.id, sectionId: parent?.sectionId ?? sectionId, parentId: parent?.id ?? null,
  };
  // Âncora: o irmão logo acima no mesmo nível; sem ele, o primeiro irmão logo abaixo.
  for (let at = index - 1; at >= 0 && rows[at].depth >= depth; at--) {
    if (rows[at].depth === depth) {
      step.afterId = rows[at].id;
      break;
    }
  }
  if (!step.afterId && next?.depth === depth) step.beforeId = next.id;
  if (!wouldChange(page, active, step, tasks)) return { slot, plan: null };
  const name = sectionName(page, step.sectionId);
  const nested = parent && active.parentId !== parent.id;
  return {
    slot,
    plan: {
      valid: true, steps: [step], indicator: { type: "slot", ...slot },
      message: nested ? t("“{0}” agora é subtarefa de “{1}”", [active.title, parent.title])
        : active.sectionId !== step.sectionId ? t("Movida para {0}", [name])
          : active.parentId && !parent ? t("Promovida a tarefa")
            : parent ? t("Nova posição salva") : t("Nova posição salva em {0}", [name]),
    },
  };
}

export type KeyAction = "up" | "down" | "nest" | "promote" | "left" | "right";

/** Comandos de teclado e de menu (Alt+setas). */
export function keyboardPlan(page: ProjectPage, taskId: string, action: KeyAction, tasks = taskMap(page)): Plan | null {
  const task = tasks.get(taskId);
  if (!task) return null;
  const fail = (message: string) => invalid(message, { type: "invalid", id: task.id, message });
  if (task.status !== "active") return fail(t("Reabra a tarefa para mover"));
  const manual = page.project.view.sortMode === "manual";
  const siblings = activeSiblings(page, task, tasks);
  const index = siblings.findIndex((item) => item.id === task.id);

  if (action === "up" || action === "down") {
    if (!manual) return fail(t("Reordenar só funciona na ordenação Manual"));
    const neighbor = siblings[action === "up" ? index - 1 : index + 1];
    if (!neighbor) return null;
    const step: PositionTarget = {
      type: "position", projectId: page.project.id, sectionId: task.sectionId, parentId: task.parentId,
      ...(action === "up" ? { beforeId: neighbor.id } : { afterId: neighbor.id }),
    };
    const depth = Array.from(taskAncestors(task, tasks)).length;
    const side = action === "up" ? "before" : "after";
    const id = side === "after" ? blockEnd(neighbor, tasks, depth) : neighbor.id;
    return { valid: true, steps: [step], indicator: { type: "line", id, side, depth }, message: t("Nova posição salva") };
  }
  if (action === "nest") {
    const previous = siblings[index - 1];
    if (!previous) return fail(t("Não há tarefa acima para receber a subtarefa"));
    return nestPlan(page, task, previous, tasks);
  }
  if (action === "promote") {
    const parent = task.parentId ? tasks.get(task.parentId) : undefined;
    if (!parent) return null;
    const depth = Array.from(taskAncestors(parent, tasks)).length;
    return {
      valid: true, steps: [{ type: "promote" }],
      indicator: { type: "line", id: blockEnd(parent, tasks, depth), side: "after", depth },
      message: depth ? t("Subtarefa movida um nível acima") : t("Promovida a tarefa"),
    };
  }
  // Painel: coluna vizinha.
  const order = page.groups.map((group) => group.sectionId);
  const next = order[order.indexOf(task.sectionId) + (action === "left" ? -1 : 1)];
  if (next === undefined) return null;
  return groupPlan(page, task.id, next);
}

/** Itens do menu “⋯” de uma tarefa num projeto. */
export function menuActions(page: ProjectPage, taskId: string, tasks = taskMap(page)) {
  const actions: { action: "up" | "down" | "nest" | "promote"; label: string; key: string }[] = [];
  const order: ["up" | "down" | "nest" | "promote", string, string][] = [
    ["up", t("Mover para cima"), "Alt ↑"], ["down", t("Mover para baixo"), "Alt ↓"],
    ["nest", t("Tornar subtarefa da anterior"), "Alt →"], ["promote", t("Promover a tarefa"), "Alt ←"],
  ];
  for (const [action, label, key] of order) {
    const plan = keyboardPlan(page, taskId, action, tasks);
    if (plan?.valid) actions.push({ action, label, key });
  }
  return actions;
}

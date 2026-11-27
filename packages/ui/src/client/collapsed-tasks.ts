"use client";
// Tarefas com as subtarefas recolhidas na Lista e no Painel. Fica em memória: vale enquanto a página estiver aberta.
import { useSyncExternalStore } from "react";

let collapsed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function replace(next: Set<string>) {
  collapsed = next;
  for (const listener of listeners) listener();
}

export function toggleCollapsed(taskId: string) {
  const next = new Set(collapsed);
  if (!next.delete(taskId)) next.add(taskId);
  replace(next);
}

/** Mostra as subtarefas destas tarefas (por exemplo, quando uma tarefa passa a ser subtarefa de uma recolhida). */
export function expandTasks(taskIds: Iterable<string>) {
  const next = new Set(collapsed);
  let changed = false;
  for (const id of taskIds) changed = next.delete(id) || changed;
  if (changed) replace(next);
}

const empty: ReadonlySet<string> = new Set();

export function useCollapsedTasks() {
  return useSyncExternalStore(subscribe, () => collapsed, () => empty);
}

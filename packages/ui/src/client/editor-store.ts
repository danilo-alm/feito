"use client";
// Editor rápido em linha: no máximo um aberto por vez, no lugar de uma tarefa ou de um botão "Adicionar tarefa".
import { useSyncExternalStore } from "react";
import type { DraftText } from "./composer";

export type InsertDefaults = {
  projectId?: string;
  sectionId?: string | null;
  parentId?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
  /** Posição da tarefa criada: antes ou depois de uma irmã (só com ordenação manual). */
  beforeId?: string;
  afterId?: string;
};

export type EditorTarget =
  | { kind: "edit"; key: string; taskId: string }
  | { kind: "create"; key: string; defaults: InsertDefaults; /** Texto levado quando o editor muda de lugar. */ text?: DraftText };

let current: EditorTarget | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openEditor(target: EditorTarget) {
  current = target;
  emit();
}

/** Fecha o editor aberto; com `key`, só se for aquele (evita fechar um editor aberto depois). */
export function closeEditor(key?: string) {
  if (!current || (key && current.key !== key)) return;
  current = null;
  emit();
}

export function currentEditor() {
  return current;
}

export function useEditorTarget() {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

export function useEditorOpen(key: string) {
  return useSyncExternalStore(subscribe, () => current?.key === key, () => false);
}

/** Chave da tarefa em edição. Inclui a data: a mesma recorrente pode aparecer em mais de um dia. */
export const editKey = (task: { id: string; dueDate: string | null }) => `edit:${task.id}:${task.dueDate ?? ""}`;
export const insertKey = (side: "above" | "below", taskId: string) => `insert:${side}:${taskId}`;

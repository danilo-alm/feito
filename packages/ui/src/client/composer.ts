"use client";
// Texto de criação enviado de forma otimista: o editor limpa o campo na hora e o texto fica só na memória até a
// gravação terminar. Se ela falhar, o texto volta ao editor aberto quando ele está vazio; senão, entra na lista
// de tentativas que o aviso de recuperação mostra para o usuário copiar.
import { useSyncExternalStore } from "react";

export type DraftText = { title: string; description: string };
export type FailedDraft = DraftText & { id: number };

type Composer = { read: () => DraftText; write: (text: DraftText) => void };

let active: Composer | null = null;
let failed: readonly FailedDraft[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isBlank = (text: DraftText) => !text.title.trim() && !text.description.trim();

/** Registra o editor de criação aberto; devolve a função que o remove. */
export function registerComposer(composer: Composer) {
  active = composer;
  return () => {
    if (active === composer) active = null;
  };
}

/** Texto atual do editor de criação aberto, se houver. */
export function composerText(): DraftText | null {
  return active?.read() ?? null;
}

/**
 * Devolve o texto de uma criação que falhou. Volta ao campo só quando o editor está aberto, vazio e não há outra
 * tentativa esperando no aviso; nos demais casos o texto vai para o aviso, sem sobrescrever o que já foi digitado.
 */
export function recoverDraft(text: DraftText): "restored" | "listed" {
  if (isBlank(text)) return "restored";
  if (active && !failed.length && isBlank(active.read())) {
    active.write(text);
    return "restored";
  }
  failed = [...failed, { ...text, id: ++sequence }];
  emit();
  return "listed";
}

export function useFailedDrafts() {
  return useSyncExternalStore(subscribe, () => failed, () => failed);
}

export function clearComposer() {
  active = null;
  dismissFailedDrafts();
}

export function dismissFailedDrafts() {
  if (!failed.length) return;
  failed = [];
  emit();
}

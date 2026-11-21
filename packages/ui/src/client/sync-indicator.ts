"use client";

import { useSyncExternalStore } from "react";

const key = "feito:hide-sync-indicator";
const listeners = new Set<() => void>();
let hidden = false;

function getSnapshot() {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return hidden;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setSyncIndicatorHidden(value: boolean) {
  hidden = value;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Sem armazenamento disponível, mantém a escolha durante esta sessão.
  }
  listeners.forEach((listener) => listener());
}

export function useSyncIndicatorHidden() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

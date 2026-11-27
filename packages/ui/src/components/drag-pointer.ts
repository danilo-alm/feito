"use client";
import { useEffect } from "react";
import type { DragMoveEvent } from "@dnd-kit/core";

// Posição real do ponteiro durante o arraste (o delta da biblioteca inclui a rolagem automática).
let lastPointerY: number | null = null;
let lastPointerX: number | null = null;
const trackPointer = (event: PointerEvent | TouchEvent) => {
  lastPointerY = "touches" in event ? event.touches[0]?.clientY ?? lastPointerY : event.clientY;
  lastPointerX = "touches" in event ? event.touches[0]?.clientX ?? lastPointerX : event.clientX;
};

function startPoint(event: Pick<DragMoveEvent, "activatorEvent">) {
  const start = event.activatorEvent as MouseEvent & TouchEvent;
  return "touches" in start && start.touches?.length ? start.touches[0] : start as MouseEvent;
}

export function pointerY(event: DragMoveEvent) {
  if (lastPointerY !== null) return lastPointerY;
  return startPoint(event).clientY + event.delta.y;
}

export function pointerX(event: DragMoveEvent) {
  if (lastPointerX !== null) return lastPointerX;
  return startPoint(event).clientX + event.delta.x;
}

/** Onde o ponteiro estava quando o arraste começou. */
export function startX(event: Pick<DragMoveEvent, "activatorEvent">) {
  return startPoint(event).clientX;
}

/** Horizontal distance from where the drag began (the page does not scroll sideways). */
export function pointerDeltaX(event: DragMoveEvent) {
  const start = startPoint(event).clientX;
  return lastPointerX === null ? event.delta.x : lastPointerX - start;
}

// Enquanto um arraste por toque está ativo, a rolagem nativa da página fica bloqueada.
// O ouvinte é registrado antes do gesto (não passivo) para que o navegador aceite o preventDefault;
// antes da ativação por toque prolongado, a rolagem continua normal.
let dragActive = false;
const blockScroll = (event: TouchEvent) => {
  if (dragActive && event.cancelable) event.preventDefault();
};

/** Há um arraste em andamento (de tarefa, projeto ou etiqueta). */
export const isDragActive = () => dragActive;

export function useTouchScrollGuard() {
  useEffect(() => {
    document.addEventListener("touchmove", blockScroll, { passive: false });
    return () => {
      document.removeEventListener("touchmove", blockScroll);
      listenPointer(false);
    };
  }, []);
}

export function listenPointer(on: boolean) {
  dragActive = on;
  const method = on ? "addEventListener" : "removeEventListener";
  window[method]("pointermove", trackPointer as EventListener, { capture: true, passive: true } as AddEventListenerOptions);
  window[method]("touchmove", trackPointer as EventListener, { capture: true, passive: true } as AddEventListenerOptions);
  if (!on) {
    lastPointerY = null;
    lastPointerX = null;
  }
}

/** Toque prolongado sem mover: mesmo tempo e tolerância do arraste por toque. */
export const LONG_PRESS_MS = 400;
export const LONG_PRESS_TOLERANCE = 8;

/**
 * Depois de um toque prolongado que abriu um menu, descarta o clique que o navegador gera ao soltar o dedo
 * (abriria a tarefa ou fecharia a folha recém-aberta).
 */
export function swallowReleaseClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 600);
}

/** Depois de soltar um arraste, descarta o clique que o navegador gera sobre o link ou botão de origem. */
export function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

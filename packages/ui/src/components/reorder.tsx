"use client";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors,
  type DragMoveEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type TouchEvent,
} from "react";
import type { OrderAnchor } from "@feito/core/types";
import { listenPointer, pointerY, swallowNextClick, useTouchScrollGuard } from "./drag-pointer";
import { flipFrom } from "./motion";

/** Propriedades que cada linha espalha no elemento que pode ser arrastado. */
export type ReorderHandle = {
  ref: (node: HTMLElement | null) => void;
  props: {
    "data-reorder-item": string;
    "data-flip": string;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onContextMenu: (event: MouseEvent<HTMLElement>) => void;
    onMouseDown?: (event: MouseEvent<HTMLElement>) => void;
    onTouchStart?: (event: TouchEvent<HTMLElement>) => void;
  };
  /** Linha que está sendo arrastada: fica esmaecida no lugar onde vai cair. */
  dragging: boolean;
};

type DragState = { id: string; index: number };

/** Posição em que o item cairia, contando os vizinhos cujo meio fica acima do ponteiro. */
function dropIndex(list: string, others: { id: string }[], y: number) {
  let index = 0;
  for (const other of others) {
    const node = document.querySelector(`[data-reorder-item="${list}:${other.id}"]`);
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    if (rect.top + rect.height / 2 < y) index++;
  }
  return index;
}

function anchorAt(others: { id: string }[], index: number): OrderAnchor {
  return index > 0 ? { afterId: others[index - 1].id } : { beforeId: others[0]?.id };
}

function focusTarget(node: HTMLElement | null) {
  if (!node) return null;
  return node.matches("a,button") ? node : node.querySelector<HTMLElement>("a[href],button");
}

/**
 * Lista vertical reordenável: arrastar com o mouse, segurar e arrastar no toque, ou Alt+↑/↓ no teclado.
 * A linha em arraste aparece esmaecida na posição de destino; ao soltar, `onMove` recebe o vizinho de referência
 * e a ordem nova completa.
 */
export function ReorderList<T extends { id: string }>({
  items, onMove, renderItem, renderOverlay, instructions, disabled = false,
}: {
  items: T[];
  onMove: (item: T, anchor: OrderAnchor, order: string[]) => void;
  renderItem: (item: T, handle: ReorderHandle) => ReactNode;
  renderOverlay: (item: T) => ReactNode;
  instructions: string;
  disabled?: boolean;
}) {
  const list = useId();
  const [drag, setDrag] = useState<DragState | null>(null);
  const focusAfter = useRef<string | null>(null);
  useTouchScrollGuard();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
  );

  useLayoutEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    focusTarget(document.querySelector<HTMLElement>(`[data-reorder-item="${list}:${id}"]`))?.focus();
  }, [items, list]);

  const move = (item: T, index: number) => {
    const others = items.filter((other) => other.id !== item.id);
    if (index === items.indexOf(item) || index < 0 || index > others.length) return false;
    const order = others.map((other) => other.id);
    order.splice(index, 0, item.id);
    onMove(item, anchorAt(others, index), order);
    return true;
  };

  const onKeyDown = (item: T) => (event: KeyboardEvent<HTMLElement>) => {
    if (disabled || !event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) return;
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    if (move(item, items.indexOf(item) + step)) focusAfter.current = item.id;
  };

  const onDragStart = (event: DragStartEvent) => {
    listenPointer(true);
    const id = String(event.active.id);
    setDrag({ id, index: items.findIndex((item) => item.id === id) });
  };
  const onDragMove = (event: DragMoveEvent) => {
    const id = String(event.active.id);
    const index = dropIndex(list, items.filter((item) => item.id !== id), pointerY(event));
    setDrag((current) => current && current.index !== index ? { ...current, index } : current);
  };
  const finish = (drop: boolean) => {
    listenPointer(false);
    swallowNextClick();
    const state = drag;
    if (state) flipFrom(`${list}:${state.id}`, document.querySelector<HTMLElement>(".drag-overlay"));
    setDrag(null);
    const item = state && items.find((candidate) => candidate.id === state.id);
    if (drop && item) move(item, state.index);
  };

  const active = drag ? items.find((item) => item.id === drag.id) : undefined;
  const shown = active ? items.filter((item) => item !== active) : items;
  if (active) shown.splice(drag!.index, 0, active);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove}
      onDragEnd={() => finish(true)} onDragCancel={() => finish(false)}
      autoScroll={{ threshold: { x: 0, y: 0.1 }, acceleration: 8 }}
      accessibility={{ screenReaderInstructions: { draggable: instructions } }}>
      {shown.map((item) => (
        <ReorderItem key={item.id} id={item.id} list={list} disabled={disabled} dragging={item === active}
          onKeyDown={onKeyDown(item)}>
          {(handle) => renderItem(item, handle)}
        </ReorderItem>
      ))}
      <DragOverlay dropAnimation={null}>
        {active && <div className="drag-overlay reorder-overlay">{renderOverlay(active)}</div>}
      </DragOverlay>
    </DndContext>
  );
}

function ReorderItem({ id, list, disabled, dragging, onKeyDown, children }: {
  id: string;
  list: string;
  disabled: boolean;
  dragging: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  children: (handle: ReorderHandle) => ReactNode;
}) {
  const { setNodeRef, listeners } = useDraggable({ id, disabled });
  const key = `${list}:${id}`;
  return children({
    ref: setNodeRef,
    dragging,
    props: {
      "data-reorder-item": key,
      "data-flip": key,
      onKeyDown,
      // O toque prolongado que inicia o arraste não deve abrir o menu do link.
      onContextMenu: (event) => {
        if (document.querySelector(".drag-overlay")) event.preventDefault();
      },
      ...(listeners as Pick<ReorderHandle["props"], "onMouseDown" | "onTouchStart"> | undefined),
    },
  });
}

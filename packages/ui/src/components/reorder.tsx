"use client";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors,
  type DragMoveEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type TouchEvent,
} from "react";
import type { OrderAnchor } from "@feito/core/types";
import { moveInTree, subtreeIds, treeDepths, treeStep, type TreeItem, type TreePlacement } from "../client/manual-order";
import { listenPointer, pointerDeltaX, pointerY, swallowNextClick, useTouchScrollGuard } from "./drag-pointer";
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
  /** Nível na árvore (0 no topo); na linha em arraste, o nível em que vai cair. */
  depth: number;
};

type DragState = { id: string; index: number; depth: number; /** Distância do ponteiro ao topo da linha. */ grab: number };

/** Deslocamento horizontal que muda um nível durante o arraste. */
const INDENT_STEP = 20;
/** Na árvore, espaço entre o ponteiro e o topo da cópia arrastada. */
const TREE_OVERLAY_GAP = 10;

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

/** Níveis possíveis entre os vizinhos `prev` e `next`: do nível de `next` até um abaixo de `prev`. */
function depthRange(depths: Map<string, number>, prev?: { id: string }, next?: { id: string }) {
  return { min: next ? depths.get(next.id)! : 0, max: prev ? depths.get(prev.id)! + 1 : 0 };
}

/** Pai e vizinho de referência para cair na posição `index` de `others`, no nível `depth`. */
function placementAt(others: { id: string }[], depths: Map<string, number>, index: number, depth: number): TreePlacement {
  let parentId: string | null = null;
  let afterId: string | undefined;
  for (let at = index - 1; at >= 0; at--) {
    const level = depths.get(others[at].id)!;
    if (level === depth && afterId === undefined) afterId = others[at].id;
    if (level < depth) {
      parentId = others[at].id;
      break;
    }
  }
  if (depth === 0) parentId = null;
  if (afterId) return { parentId, afterId };
  const next = others[index];
  return next && depths.get(next.id) === depth ? { parentId, beforeId: next.id } : { parentId };
}

function focusTarget(node: HTMLElement | null) {
  if (!node) return null;
  return node.matches("a,button") ? node : node.querySelector<HTMLElement>("a[href],button");
}

/**
 * Lista vertical reordenável: arrastar com o mouse, segurar e arrastar no toque, ou Alt+↑/↓ no teclado.
 * A linha em arraste aparece esmaecida na posição de destino; ao soltar, `onMove` recebe o vizinho de referência
 * e a ordem nova completa.
 *
 * Com `tree`, os itens vêm em ordem de árvore (cada pai seguido dos filhos) e cada um se move com os descendentes.
 * Arrastar para a direita recua a linha de destino um nível, tornando o item filho do que fica acima;
 * para a esquerda, sobe de nível. No teclado, Alt+→ e Alt+← fazem o mesmo. `onMove` recebe também o novo pai.
 */
export function ReorderList<T extends { id: string }>({
  items, onMove, renderItem, renderOverlay, instructions, disabled = false, tree,
}: {
  items: T[];
  onMove: (item: T, anchor: OrderAnchor & { parentId?: string | null }, order: string[]) => void;
  renderItem: (item: T, handle: ReorderHandle) => ReactNode;
  renderOverlay: (item: T) => ReactNode;
  instructions: string;
  disabled?: boolean;
  /** Pai de cada item, para listas em árvore. */
  tree?: (item: T) => string | null;
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

  const nodes: TreeItem[] = tree ? items.map((item) => ({ id: item.id, parentId: tree(item) })) : [];
  const depths = treeDepths(nodes);
  const depthOf = (id: string) => depths.get(id) ?? 0;
  /** Itens que continuam no lugar enquanto `id` se move (sem ele e, na árvore, sem os descendentes). */
  const othersOf = (id: string) => {
    const moving = tree ? subtreeIds(nodes, id) : new Set([id]);
    return items.filter((item) => !moving.has(item.id));
  };

  const move = (item: T, index: number) => {
    const others = items.filter((other) => other.id !== item.id);
    if (index === items.indexOf(item) || index < 0 || index > others.length) return false;
    const order = others.map((other) => other.id);
    order.splice(index, 0, item.id);
    onMove(item, anchorAt(others, index), order);
    return true;
  };

  const place = (item: T, placement: TreePlacement | null) => {
    if (!placement) return false;
    const order = moveInTree(nodes, item.id, placement);
    const same = (tree!(item) ?? null) === placement.parentId
      && order.every((node, index) => node.id === nodes[index].id);
    if (same) return false;
    onMove(item, placement, order.map((node) => node.id));
    return true;
  };

  const onKeyDown = (item: T) => (event: KeyboardEvent<HTMLElement>) => {
    if (disabled || !event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (tree) {
      const step = ({ ArrowUp: "up", ArrowDown: "down", ArrowRight: "in", ArrowLeft: "out" } as const)[event.key as "ArrowUp"];
      if (!step) return;
      event.preventDefault();
      if (place(item, treeStep(nodes, item.id, step))) focusAfter.current = item.id;
      return;
    }
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    if (move(item, items.indexOf(item) + step)) focusAfter.current = item.id;
  };

  const onDragStart = (event: DragStartEvent) => {
    listenPointer(true);
    const id = String(event.active.id);
    const start = event.activatorEvent as Event & { clientY?: number; touches?: TouchList };
    const startY = start.touches?.length ? start.touches[0].clientY : start.clientY ?? 0;
    const top = document.querySelector(`[data-reorder-item="${list}:${id}"]`)?.getBoundingClientRect().top ?? startY;
    setDrag({ id, index: items.findIndex((item) => item.id === id), depth: depthOf(id), grab: startY - top });
  };
  const onDragMove = (event: DragMoveEvent) => {
    const id = String(event.active.id);
    const others = othersOf(id);
    const index = dropIndex(list, others, pointerY(event));
    let depth = 0;
    if (tree) {
      const { min, max } = depthRange(depths, others[index - 1], others[index]);
      const wanted = depthOf(id) + Math.round(pointerDeltaX(event) / INDENT_STEP);
      depth = Math.min(max, Math.max(min, wanted));
    }
    setDrag((current) => current && (current.index !== index || current.depth !== depth) ? { ...current, index, depth } : current);
  };
  const finish = (drop: boolean) => {
    listenPointer(false);
    swallowNextClick();
    const state = drag;
    if (state) flipFrom(`${list}:${state.id}`, document.querySelector<HTMLElement>(".drag-overlay"));
    setDrag(null);
    const item = state && items.find((candidate) => candidate.id === state.id);
    if (!drop || !item) return;
    if (tree) place(item, placementAt(othersOf(item.id), depths, state.index, state.depth));
    else move(item, state.index);
  };

  const active = drag ? items.find((item) => item.id === drag.id) : undefined;
  const shown = active ? othersOf(active.id) : items;
  if (active) shown.splice(drag!.index, 0, active);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove}
      onDragEnd={() => finish(true)} onDragCancel={() => finish(false)}
      autoScroll={{ threshold: { x: 0, y: 0.1 }, acceleration: 8 }}
      accessibility={{ screenReaderInstructions: { draggable: instructions } }}>
      {shown.map((item) => (
        <ReorderItem key={item.id} id={item.id} list={list} disabled={disabled} dragging={item === active}
          depth={item === active ? drag!.depth : depthOf(item.id)} onKeyDown={onKeyDown(item)}>
          {(handle) => renderItem(item, handle)}
        </ReorderItem>
      ))}
      <DragOverlay dropAnimation={null}>
        {/* Na árvore, a cópia fica logo abaixo do ponteiro para não cobrir a linha que marca o destino. */}
        {active && <div className="drag-overlay reorder-overlay"
          style={tree ? { transform: `translateY(${Math.round(drag!.grab) + TREE_OVERLAY_GAP}px)` } : undefined}>
          {renderOverlay(active)}
        </div>}
      </DragOverlay>
    </DndContext>
  );
}

function ReorderItem({ id, list, disabled, dragging, depth, onKeyDown, children }: {
  id: string;
  list: string;
  disabled: boolean;
  dragging: boolean;
  depth: number;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  children: (handle: ReorderHandle) => ReactNode;
}) {
  const { setNodeRef, listeners } = useDraggable({ id, disabled });
  const key = `${list}:${id}`;
  return children({
    ref: setNodeRef,
    dragging,
    depth,
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

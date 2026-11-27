import type { Label, Navigation, OrderAnchor } from "@feito/core/types";
import { beginProjection, setQueryData, type QueryData } from "./store";

export type OrderKind = "projects" | "labels";

/** Ordena `items` pela lista de ids; itens ausentes dela seguem no fim, na ordem atual. */
export function inOrder<T extends { id: string }>(items: readonly T[], ids: readonly string[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const listed = new Set(ids);
  return [
    ...ids.flatMap((id) => byId.get(id) ?? []),
    ...items.filter((item) => !listed.has(item.id)),
  ];
}

/** Item of a tree listed in depth-first order: each parent followed by its children. */
export type TreeItem = { id: string; parentId: string | null };
/** Destination in a tree: the new parent and a sibling of reference (none = end of the siblings). */
export type TreePlacement = OrderAnchor & { parentId: string | null };

/** Depth of each item; a parent missing from the list counts as the top level. */
export function treeDepths(items: readonly TreeItem[]) {
  const depths = new Map<string, number>();
  for (const item of items) {
    const parentDepth = item.parentId === null ? undefined : depths.get(item.parentId);
    depths.set(item.id, parentDepth === undefined ? 0 : parentDepth + 1);
  }
  return depths;
}

function parentIn(items: readonly TreeItem[], item: TreeItem) {
  return item.parentId !== null && items.some((other) => other.id === item.parentId) ? item.parentId : null;
}

/** The item and its descendants, which follow it in depth-first order. */
export function subtreeIds(items: readonly TreeItem[], id: string) {
  const ids = new Set([id]);
  const depths = treeDepths(items);
  const start = items.findIndex((item) => item.id === id);
  for (const item of items.slice(start + 1)) {
    if (depths.get(item.id)! <= depths.get(id)!) break;
    ids.add(item.id);
  }
  return ids;
}

export function siblingsOf<T extends TreeItem>(items: readonly T[], item: TreeItem) {
  const parentId = parentIn(items, item);
  return items.filter((other) => parentIn(items, other) === parentId);
}

/** New depth-first order after moving `id`, with its descendants, to `placement`. */
export function moveInTree<T extends TreeItem>(items: readonly T[], id: string, placement: TreePlacement): T[] {
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    if (item.id === id) continue;
    const parentId = parentIn(items, item);
    children.set(parentId, [...children.get(parentId) ?? [], item]);
  }
  const moved = items.find((item) => item.id === id);
  if (!moved) return [...items];
  const siblings = children.get(placement.parentId) ?? [];
  const anchorId = placement.afterId ?? placement.beforeId;
  const at = anchorId ? siblings.findIndex((sibling) => sibling.id === anchorId) : -1;
  siblings.splice(at < 0 ? siblings.length : at + Number(Boolean(placement.afterId)), 0, { ...moved, parentId: placement.parentId });
  children.set(placement.parentId, siblings);
  const ordered: T[] = [];
  const visit = (parentId: string | null) => {
    for (const item of children.get(parentId) ?? []) {
      ordered.push(item);
      visit(item.id);
    }
  };
  visit(null);
  return ordered;
}

/**
 * Keyboard and menu steps: up and down among the siblings, into the previous sibling (as its last child)
 * or out of the parent (right after it). Returns null when the step is not possible.
 */
export function treeStep(items: readonly TreeItem[], id: string, step: "up" | "down" | "in" | "out"): TreePlacement | null {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return null;
  const parentId = parentIn(items, item);
  const siblings = siblingsOf(items, item);
  const index = siblings.findIndex((sibling) => sibling.id === id);
  if (step === "up") return index > 0 ? { parentId, beforeId: siblings[index - 1].id } : null;
  if (step === "down") return index < siblings.length - 1 ? { parentId, afterId: siblings[index + 1].id } : null;
  if (step === "in") return index > 0 ? { parentId: siblings[index - 1].id } : null;
  if (parentId === null) return null;
  return { parentId: parentIn(items, items.find((candidate) => candidate.id === parentId)!), afterId: parentId };
}

/** Optimistic parent change shown together with the new order of the projects. */
export type ParentChange = { id: string; parentId: string | null };

function orderNavigation(
  nav: Navigation | undefined, kind: OrderKind, ids: readonly string[], parent?: ParentChange,
): Navigation | undefined {
  if (!nav) return nav;
  if (kind === "labels") return { ...nav, labels: inOrder(nav.labels, ids) };
  const projects = inOrder(nav.projects, ids);
  return {
    ...nav,
    projects: parent ? projects.map((project) => project.id === parent.id ? { ...project, parentId: parent.parentId } : project) : projects,
  };
}

function orderLabels(list: { labels: Label[] } | undefined, ids: readonly string[]) {
  return list && { ...list, labels: inOrder(list.labels, ids) };
}

function applyOrder(data: QueryData, kind: OrderKind, ids: readonly string[], parent?: ParentChange) {
  if (data.has("nav")) data.set("nav", orderNavigation(data.get("nav") as Navigation | undefined, kind, ids, parent));
  if (kind === "labels" && data.has("labels")) {
    data.set("labels", orderLabels(data.get("labels") as { labels: Label[] } | undefined, ids));
  }
}

/**
 * Mostra a nova ordem na hora, envia a escrita e aplica a ordem oficial da resposta.
 * Em caso de falha, só esta previsão é descartada.
 */
export async function moveInOrder(
  kind: OrderKind, predicted: readonly string[], send: () => Promise<string[]>, parent?: ParentChange,
) {
  const projection = beginProjection((data) => applyOrder(data, kind, predicted, parent));
  try {
    const ids = await send();
    setQueryData<Navigation>("nav", (nav) => orderNavigation(nav, kind, ids, parent));
    if (kind === "labels") setQueryData<{ labels: Label[] }>("labels", (list) => orderLabels(list, ids));
    return ids;
  } finally {
    projection.finish();
  }
}

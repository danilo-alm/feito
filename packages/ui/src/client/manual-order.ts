import type { Label, Navigation } from "@feito/core/types";
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

function orderNavigation(nav: Navigation | undefined, kind: OrderKind, ids: readonly string[]): Navigation | undefined {
  if (!nav) return nav;
  return kind === "projects" ? { ...nav, projects: inOrder(nav.projects, ids) } : { ...nav, labels: inOrder(nav.labels, ids) };
}

function orderLabels(list: { labels: Label[] } | undefined, ids: readonly string[]) {
  return list && { ...list, labels: inOrder(list.labels, ids) };
}

function applyOrder(data: QueryData, kind: OrderKind, ids: readonly string[]) {
  if (data.has("nav")) data.set("nav", orderNavigation(data.get("nav") as Navigation | undefined, kind, ids));
  if (kind === "labels" && data.has("labels")) {
    data.set("labels", orderLabels(data.get("labels") as { labels: Label[] } | undefined, ids));
  }
}

/**
 * Mostra a nova ordem na hora, envia a escrita e aplica a ordem oficial da resposta.
 * Em caso de falha, só esta previsão é descartada.
 */
export async function moveInOrder(kind: OrderKind, predicted: readonly string[], send: () => Promise<string[]>) {
  const projection = beginProjection((data) => applyOrder(data, kind, predicted));
  try {
    const ids = await send();
    setQueryData<Navigation>("nav", (nav) => orderNavigation(nav, kind, ids));
    if (kind === "labels") setQueryData<{ labels: Label[] }>("labels", (list) => orderLabels(list, ids));
    return ids;
  } finally {
    projection.finish();
  }
}

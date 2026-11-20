import "server-only";
import type { TaskChanges, TaskState } from "@/client/types";
import { byPosition, childrenByParent, type Product, type Task, type TaskGroup } from "@/domain/product";
import { taskItem } from "./product-dto";

export function taskChanges(before: Product, after: Product, revision: number): TaskChanges {
  const ids = new Set<string>();
  const groups = new Map<string, TaskGroup & { orderedIds: string[] }>();
  const groupKey = ({ projectId, sectionId, parentId }: TaskGroup) => JSON.stringify([projectId, sectionId, parentId]);
  const initialChildren = childrenByParent(before.tasks.values());
  const currentChildren = childrenByParent(after.tasks.values());

  const markGroup = (task: Task | undefined) => {
    if (!task) return;
    const { projectId, sectionId, parentId } = task;
    groups.set(groupKey(task), { projectId, sectionId, parentId, orderedIds: [] });
  };

  for (const id of new Set([...before.tasks.keys(), ...after.tasks.keys()])) {
    const previous = before.tasks.get(id);
    const next = after.tasks.get(id);
    if (previous === next && before.taskLabels.get(id) === after.taskLabels.get(id)) continue;
    ids.add(id);
    if (previous?.parentId !== next?.parentId || previous?.data.completedAt !== next?.data.completedAt
      || previous?.data.position !== next?.data.position) {
      if (previous?.parentId) ids.add(previous.parentId);
      if (next?.parentId) ids.add(next.parentId);
    }
    const sameParent = previous?.parentId && previous.parentId === next?.parentId;
    if ((!sameParent && (!previous || !next || groupKey(previous) !== groupKey(next)))
      || previous?.data.position !== next?.data.position) {
      markGroup(previous);
      markGroup(next);
    }
    if (previous && next && !next.parentId) {
      const sort = after.projects.get(next.projectId)?.data.view.sortMode;
      if ((sort === "priority" && previous.data.priority !== next.data.priority)
        || (sort === "date" && (previous.data.dueDate !== next.data.dueDate || previous.data.dueTime !== next.data.dueTime))) {
        markGroup(next);
      }
    }
    if (previous?.data.title !== next?.data.title) {
      for (const child of currentChildren.get(id) ?? []) ids.add(child.id);
    }
  }

  if (groups.size) {
    for (const task of [...after.tasks.values()].filter((item) => groups.has(groupKey(item))).sort(byPosition)) {
      groups.get(groupKey(task))!.orderedIds.push(task.id);
    }
  }

  const state = (product: Product, children: Map<string, Task[]>, id: string): TaskState | undefined => {
    const task = product.tasks.get(id);
    if (!task) return undefined;
    return {
      ...taskItem(product, task, { origin: true, children: children.get(id) ?? [] }),
      ...(product === after && {
        description: task.data.description,
        createdAt: task.data.createdAt,
      }),
    };
  };

  return {
    revision: revision + Number(ids.size > 0),
    rows: [...ids].map((id) => ({ before: state(before, initialChildren, id), after: state(after, currentChildren, id) })),
    ...(groups.size ? { groups: [...groups.values()] } : {}),
  };
}

export function* walkTaskTree<T>(roots: readonly T[], childrenOf: (task: T) => readonly T[], maxDepth = Infinity) {
  const stack = roots.map((task) => ({ task, depth: 0 })).reverse();
  while (stack.length) {
    const { task, depth } = stack.pop()!;
    yield { task, depth };
    if (depth >= maxDepth) continue;
    const children = childrenOf(task);
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({ task: children[index], depth: depth + 1 });
    }
  }
}

export function* taskAncestors<T extends { parentId: string | null }>(task: T, tasks: ReadonlyMap<string, T>) {
  let parent = task.parentId ? tasks.get(task.parentId) : undefined;
  while (parent) {
    yield parent;
    parent = parent.parentId ? tasks.get(parent.parentId) : undefined;
  }
}

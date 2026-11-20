// Shared service entry points allocate IDs synchronously, before invoking persistence.
let scope: { supplied: readonly string[]; captured: string[] } | undefined;

export function withOperationIds<T>(supplied: readonly string[], run: () => T) {
  const previous = scope;
  const captured: string[] = [];
  scope = { supplied, captured };
  try {
    return { result: run(), generatedIds: captured };
  } finally {
    scope = previous;
  }
}

export function randomUUID(): string {
  if (!scope) return globalThis.crypto.randomUUID();
  const id = scope.supplied[scope.captured.length] ?? globalThis.crypto.randomUUID();
  scope.captured.push(id);
  return id;
}

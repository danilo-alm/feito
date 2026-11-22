type Renderer = typeof import("../components/markdown-renderer");
type State = { status: "idle" | "loading" | "error"; renderer: null } | { status: "ready"; renderer: Renderer };

const initial: State = { status: "idle", renderer: null };
let state: State = initial;
let pending: Promise<Renderer> | undefined;
const listeners = new Set<() => void>();

export const getMarkdown = () => state;
export const serverMarkdown = () => initial;
export function subscribeMarkdown(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

/** Um único carregamento atende resumos e descrições; falhas permitem nova tentativa. */
export function loadMarkdown(): Promise<Renderer> {
  if (state.renderer) return Promise.resolve(state.renderer);
  if (pending) return pending;
  pending = import("../components/markdown-renderer").then((renderer) => {
    publish({ status: "ready", renderer });
    return renderer;
  }, (error: unknown) => {
    publish({ status: "error", renderer: null });
    throw error;
  }).finally(() => { pending = undefined; });
  publish({ status: "loading", renderer: null });
  return pending;
}

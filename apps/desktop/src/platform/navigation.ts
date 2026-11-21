import { useMemo, useSyncExternalStore } from "react";

const base = "https://feito.desktop";
const navigation = "feito:navigate";

function current() {
  return location.hash.startsWith("#/") ? location.hash.slice(1) : "/hoje";
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  window.addEventListener(navigation, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(navigation, onChange);
  };
}

/**
 * Posição na pilha do histórico da janela, para habilitar Voltar e Avançar.
 * O índice fica em history.state; o fim da pilha fica no sessionStorage para resistir a recargas.
 */
const historyEnd = "feito:history-end";

function stateIndex(): number {
  const index = (history.state as { index?: unknown } | null)?.index;
  return typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : 0;
}

function readEnd(): number {
  try {
    const end = Number(sessionStorage.getItem(historyEnd));
    return Number.isInteger(end) && end >= 0 ? end : 0;
  } catch {
    return 0;
  }
}

function writeEnd(end: number) {
  try {
    sessionStorage.setItem(historyEnd, String(end));
  } catch {
    // Sem armazenamento, Avançar só fica disponível até a próxima recarga.
  }
}

let end = Math.max(readEnd(), stateIndex());
if (typeof (history.state as { index?: unknown } | null)?.index !== "number") history.replaceState({ index: 0 }, "");
let position = { index: stateIndex(), end };

function updatePosition() {
  if (typeof (history.state as { index?: unknown } | null)?.index !== "number") return;
  const index = stateIndex();
  if (index !== position.index || end !== position.end) position = { index, end };
}

window.addEventListener("popstate", updatePosition);
// Âncoras nativas (#dia-…) criam entradas sem índice: elas continuam a pilha a partir da anterior.
window.addEventListener("hashchange", () => {
  if (typeof (history.state as { index?: unknown } | null)?.index !== "number") {
    const index = position.index + 1;
    history.replaceState({ index }, "");
    end = index;
    writeEnd(end);
  }
  updatePosition();
});

function go(target: string, replace: boolean) {
  const route = new URL(target, base + current());
  if (route.origin !== base) return;
  const href = route.pathname + route.search + route.hash;
  if (href !== current()) {
    const index = stateIndex();
    if (replace) {
      history.replaceState({ index }, "", "#" + href);
    } else {
      history.pushState({ index: index + 1 }, "", "#" + href);
      end = index + 1;
      writeEnd(end);
    }
    updatePosition();
    window.dispatchEvent(new Event(navigation));
  }
  if (route.hash) {
    requestAnimationFrame(() => document.getElementById(route.hash.slice(1))?.scrollIntoView());
  }
}

const router = {
  push: (href: string) => go(href, false),
  replace: (href: string) => go(href, true),
};

function getPosition() {
  return position;
}

/** Voltar e Avançar da janela, com a disponibilidade de cada direção. */
export function useHistoryNavigation() {
  const { index, end: last } = useSyncExternalStore(subscribe, getPosition);
  return {
    canGoBack: index > 0,
    canGoForward: index < last,
    back: () => { if (stateIndex() > 0) history.back(); },
    forward: () => { if (stateIndex() < end) history.forward(); },
  };
}

export function useRouter() {
  return router;
}

export function useRoute() {
  const href = useSyncExternalStore(subscribe, current);
  return useMemo(() => new URL(href, base), [href]);
}

export function usePathname() {
  return useRoute().pathname;
}

export function useSearchParams() {
  return useRoute().searchParams;
}

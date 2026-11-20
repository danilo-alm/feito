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

function go(target: string, replace: boolean) {
  const route = new URL(target, base + current());
  if (route.origin !== base) return;
  const href = route.pathname + route.search + route.hash;
  if (href !== current()) {
    history[replace ? "replaceState" : "pushState"](null, "", "#" + href);
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

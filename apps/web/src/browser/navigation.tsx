"use client";
import { useMemo, useSyncExternalStore, type ComponentProps } from "react";

const navigation = "feito:navigate";
const fallback = "https://feito.invalid/";
const appPaths = /^\/(?:hoje|entrada|em-breve|busca|navegar|ajustes|entrar|trocar-senha|projetos\/[^/]+|etiquetas\/[^/]+)?\/?$/;

export function isBrowserRoute(pathname: string) {
  return appPaths.test(pathname);
}

function current() {
  return location.href;
}

function subscribe(listener: () => void) {
  window.addEventListener(navigation, listener);
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);
  return () => {
    window.removeEventListener(navigation, listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
  };
}

function navigate(href: string, replace: boolean) {
  const url = new URL(href, current());
  if (url.origin !== location.origin || !isBrowserRoute(url.pathname)) {
    if (replace) location.replace(url.href);
    else location.assign(url.href);
    return;
  }
  if (url.href !== current()) {
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    window.dispatchEvent(new Event(navigation));
  }
  if (url.hash) {
    requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView());
  }
}

export const browserRouter = { push: (href: string) => navigate(href, false), replace: (href: string) => navigate(href, true) };

export function useBrowserRoute() {
  const href = useSyncExternalStore(subscribe, current, () => fallback);
  return useMemo(() => new URL(href), [href]);
}

export function BrowserLink({ href, onClick, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  return <a href={href} {...props} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || props.download !== undefined || (props.target && props.target !== "_self")) return;
    const url = new URL(href, current());
    if (url.origin !== location.origin || !isBrowserRoute(url.pathname)) return;
    event.preventDefault();
    browserRouter.push(url.href);
  }} />;
}

export function safeNext(route: URL) {
  const href = route.searchParams.get("voltar");
  if (!href?.startsWith("/") || href.startsWith("//")) return "/hoje";
  try {
    const url = new URL(href, route);
    if (url.origin === route.origin && isBrowserRoute(url.pathname) && !["/entrar", "/trocar-senha"].includes(url.pathname)) {
      return url.pathname + url.search + url.hash;
    }
  } catch { /* URLs inválidas caem em Hoje. */ }
  return "/hoje";
}

"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useT } from "./language";
import { useTitlebar } from "./titlebar";

// Menu lateral recolhido no navegador. O app desktop guarda o seu na faixa da janela (por espaço);
// aqui vale um por aparelho. Recolher esconde o menu inteiro e deixa só o botão de mostrá-lo.
const KEY = "feito:sidebar";
const listeners = new Set<() => void>();
let collapsed = read();

function read() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleWebSidebar() {
  collapsed = !collapsed;
  try {
    localStorage.setItem(KEY, collapsed ? "collapsed" : "open");
  } catch {
    // Sem armazenamento, a escolha vale até recarregar.
  }
  listeners.forEach((listener) => listener());
}

export function useWebSidebarCollapsed() {
  return useSyncExternalStore(subscribe, () => collapsed, () => false);
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Aplica o estado no elemento raiz e liga o atalho Ctrl+\ (⌘\ no Mac). Fora do app desktop. */
export function useWebSidebarRoot() {
  const titlebar = useTitlebar();
  const value = useWebSidebarCollapsed();
  useEffect(() => {
    if (titlebar) return;
    document.documentElement.dataset.sidebar = value ? "collapsed" : "open";
  }, [titlebar, value]);
  useEffect(() => {
    if (titlebar) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || isEditable(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "\\" && matchMedia("(min-width: 600px)").matches) {
        event.preventDefault();
        toggleWebSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [titlebar]);
}

function IconSidebar() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M9.5 5v14" /></svg>;
}

/** Botão de recolher (dentro do menu) ou de mostrar (na linha de ferramentas da página). */
export function SidebarToggle({ place }: { place: "sidebar" | "page" }) {
  const t = useT();
  const titlebar = useTitlebar();
  const value = useWebSidebarCollapsed();
  if (titlebar || (place === "page" && !value)) return null;
  const label = value ? t("Mostrar menu lateral") : t("Recolher menu lateral");
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button type="button" className={`icon-btn sidebar-toggle sidebar-toggle-${place}`} aria-label={label}
      data-tooltip={`${label} (${mac ? "⌘\\" : "Ctrl+\\"})`} aria-expanded={!value} aria-keyshortcuts={mac ? "Meta+\\" : "Control+\\"}
      onClick={toggleWebSidebar}>
      <IconSidebar />
    </button>
  );
}

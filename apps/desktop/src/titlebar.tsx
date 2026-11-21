import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconChevronLeft, IconChevronRight, IconSearch } from "@feito/ui/components/icons";
import { TitlebarContext } from "@feito/ui/components/titlebar";
import { desktop } from "./data/native";
import { useHistoryNavigation, usePathname, useRouter } from "./platform/navigation";

export type TitlebarPlatform = "macos" | "windows" | "linux";

const platforms = new Set<TitlebarPlatform>(["macos", "windows", "linux"]);

/** Sistema da faixa desenhada pelo app; null fora do Tauri. Em desenvolvimento, `?titlebar=` simula um sistema no navegador. */
export function detectTitlebar(): TitlebarPlatform | null {
  if (import.meta.env.DEV) {
    const forced = new URLSearchParams(location.search).get("titlebar");
    if (forced && platforms.has(forced as TitlebarPlatform)) return forced as TitlebarPlatform;
  }
  if (!isTauri()) return null;
  const agent = navigator.userAgent;
  if (agent.includes("Macintosh")) return "macos";
  if (agent.includes("Windows")) return "windows";
  if (agent.includes("Linux")) return "linux";
  return null;
}

type WindowState = { maximized: boolean; focused: boolean; fullscreen: boolean };

function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({ maximized: false, focused: true, fullscreen: false });
  useEffect(() => {
    if (!isTauri()) {
      const onFocus = () => setState((current) => ({ ...current, focused: document.hasFocus() }));
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onFocus);
      return () => {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onFocus);
      };
    }
    const win = getCurrentWindow();
    let active = true;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => { if (active) stops.push(stop); else stop(); };
    const sync = async () => {
      const [maximized, fullscreen, focused] = await Promise.all([win.isMaximized(), win.isFullscreen(), win.isFocused()]);
      if (active) setState({ maximized, fullscreen, focused });
    };
    void sync().catch(() => undefined);
    void win.onResized(() => { void sync().catch(() => undefined); }).then(keep, () => undefined);
    void win.onFocusChanged(({ payload }) => {
      if (active) setState((current) => ({ ...current, focused: payload }));
    }).then(keep, () => undefined);
    return () => {
      active = false;
      stops.forEach((stop) => stop());
    };
  }, []);
  return state;
}

function sidebarKey(space: string) {
  return `feito:sidebar:${space}`;
}

function readCollapsed(space: string) {
  try {
    return localStorage.getItem(sidebarKey(space)) === "collapsed";
  } catch {
    return false;
  }
}

function isEditable(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function IconSidebar() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M9.5 5v14" /></svg>
  );
}

function WindowControls({ platform, maximized }: { platform: "windows" | "linux"; maximized: boolean }) {
  const control = (label: string, action: () => Promise<void>, glyph: ReactNode, kind: string) => (
    <button type="button" className={`tb-win tb-win-${kind}`} aria-label={label} data-tooltip={label}
      onClick={() => { if (isTauri()) void action().catch(() => undefined); }}>
      {platform === "linux" ? <span className="tb-dot">{glyph}</span> : glyph}
    </button>
  );
  const win = isTauri() ? getCurrentWindow() : null;
  const windows = platform === "windows";
  return (
    <div className="tb-window">
      {control("Minimizar", () => win!.minimize(), windows
        ? <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg>
        : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 10.5h7" /></svg>, "min")}
      {control(maximized ? "Restaurar" : "Maximizar", () => win!.toggleMaximize(), maximized
        ? (windows
          ? <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="2.5" width="7" height="7" rx="1" /><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" /></svg>
          : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.25" y="6.25" width="5.5" height="5.5" rx="1" /><path d="M6.25 6.25V4.75a.5.5 0 0 1 .5-.5h4.5a.5.5 0 0 1 .5.5v4.5a.5.5 0 0 1-.5.5h-1.5" /></svg>)
        : (windows
          ? <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" rx="1" /></svg>
          : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.75" y="4.75" width="6.5" height="6.5" rx="1" /></svg>), "max")}
      {control("Fechar", () => win!.close(), windows
        ? <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
        : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.25 5.25l5.5 5.5M10.75 5.25l-5.5 5.5" /></svg>, "close")}
    </div>
  );
}

/**
 * Faixa de título do desktop: setas de histórico, ferramentas e título da tela,
 * busca e recolhimento do menu lateral, e os botões da janela no Windows e no Linux.
 */
export function Titlebar({ platform, children }: { platform: TitlebarPlatform; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const history = useHistoryNavigation();
  const status = useSyncExternalStore(desktop.subscribe, desktop.getStatus);
  const { maximized, focused, fullscreen } = useWindowState();
  const [tools, setTools] = useState<HTMLElement | null>(null);
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const workspace = status.ready && status.active !== "none";
  const space = status.active === "server" ? `server:${status.server?.origin ?? ""}` : "local";
  const [collapsed, setCollapsed] = useState(() => readCollapsed(space));
  const mac = platform === "macos";
  const backKey = mac ? "⌘[" : "Alt+←";
  const forwardKey = mac ? "⌘]" : "Alt+→";
  const sidebarShortcut = mac ? "⌘\\" : "Ctrl+\\";

  useEffect(() => setCollapsed(readCollapsed(space)), [space]);

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(sidebarKey(space), next ? "collapsed" : "open");
      } catch {
        // Sem armazenamento, a escolha vale até fechar o app.
      }
      return next;
    });
  };

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.sidebar = workspace && collapsed ? "collapsed" : "open";
    root.toggleAttribute("data-window-inactive", !focused);
    root.toggleAttribute("data-fullscreen", fullscreen);
  }, [collapsed, focused, fullscreen, workspace]);

  // O título compacto aparece quando o conteúdo da rota passa por baixo da faixa.
  useEffect(() => {
    setScrolled(false);
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".side, .dialog-wrap, .popover")) return;
      // Rolagens só horizontais (colunas do Painel) não mexem no título.
      if (target instanceof Element && target !== document.documentElement && target.scrollHeight <= target.clientHeight) return;
      const top = target === document || target === document.documentElement ? window.scrollY
        : target instanceof Element ? target.scrollTop : 0;
      setScrolled(top > 40);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isEditable(event.target)) return;
      const back = mac ? event.metaKey && !event.altKey && event.key === "[" : event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowLeft";
      const forward = mac ? event.metaKey && !event.altKey && event.key === "]" : event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowRight";
      const sidebar = (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey && event.key === "\\";
      if (back || forward) {
        event.preventDefault();
        if (back) history.back();
        else history.forward();
      } else if (sidebar && workspace && matchMedia("(min-width: 900px)").matches) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sidebarLabel = collapsed ? "Mostrar menu lateral" : "Recolher menu lateral";
  return (
    <TitlebarContext.Provider value={workspace ? { tools, title, scrolled } : null}>
      <div className="tb" data-tauri-drag-region="deep">
        <div className="tb-glass tb-glass-side" aria-hidden="true" />
        <div className="tb-glass tb-glass-main" aria-hidden="true" />
        <div className="tb-row">
          <div className="tb-lead tb-app">
            {workspace && !mac && (
              <button type="button" className="tb-search" aria-keyshortcuts="/" onClick={() => router.push("/busca")}>
                <IconSearch />Buscar<span className="kbd">/</span>
              </button>
            )}
            {workspace && (
              <button type="button" className="tb-btn tb-sidebar" aria-label={sidebarLabel} data-tooltip={`${sidebarLabel} (${sidebarShortcut})`}
                aria-expanded={!collapsed} aria-keyshortcuts={mac ? "Meta+\\" : "Control+\\"} onClick={toggleSidebar}>
                <IconSidebar />
              </button>
            )}
          </div>
          <div className="tb-main">
            <div className="tb-nav tb-app">
              <button type="button" className="tb-btn" aria-label="Voltar" data-tooltip={`Voltar (${backKey})`} aria-disabled={!history.canGoBack}
                aria-keyshortcuts={mac ? "Meta+[" : "Alt+ArrowLeft"} onClick={() => history.back()}><IconChevronLeft /></button>
              <button type="button" className="tb-btn" aria-label="Avançar" data-tooltip={`Avançar (${forwardKey})`} aria-disabled={!history.canGoForward}
                aria-keyshortcuts={mac ? "Meta+]" : "Alt+ArrowRight"} onClick={() => history.forward()}><IconChevronRight /></button>
            </div>
            <div className="tb-title" ref={setTitle} />
            <div className="tb-end">
              <div className="tb-tools tb-app" ref={setTools} />
              {!mac && <WindowControls platform={platform} maximized={maximized} />}
            </div>
          </div>
        </div>
      </div>
      {children}
    </TitlebarContext.Provider>
  );
}

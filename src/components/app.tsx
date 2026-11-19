"use client";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiFailure, configureApi, errorMessage } from "@/client/api";
import { registerTagOrder } from "@/client/colors";
import { closeEditor, type InsertDefaults } from "@/client/editor-store";
import { clearCache, invalidate, useQuery } from "@/client/store";
import type { Me, Navigation, Theme } from "@/client/types";
import { motionMs, useFlip } from "./motion";
import { Dialog, Spinner, ToastProvider, useToast, type ToastAction } from "./ui";

// ---------- Tema ----------

export function applyTheme(theme: Theme) {
  try {
    localStorage.setItem("feito:theme", theme);
  } catch {
    // Preferência visual opcional; o servidor continua com o valor salvo.
  }
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function useThemeSync(theme: Theme | undefined) {
  useEffect(() => {
    if (!theme) return;
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);
}

// ---------- Contexto ----------

export type QuickAddDefaults = InsertDefaults;
export const PROJECT_SHORTCUT_KEYS = "123456789";
const PROJECT_SHORTCUT_DELAY_MS = 200;


type ConfirmOptions = { title: string; body?: ReactNode; confirmLabel: string; danger?: boolean };
type PromptOptions = { title: string; label: string; initial?: string; confirmLabel: string };
type SuccessNotice = string | { message: string; action?: ToastAction };
type RunOptions<T> = { success?: string | ((value: T) => SuccessNotice); silent?: boolean };

type AppContextValue = {
  me: Me;
  nav: Navigation | undefined;
  showProjectShortcuts: boolean;
  reference: string;
  timezone: string;
  refresh: () => Promise<unknown>;
  openQuickAdd: (defaults?: QuickAddDefaults) => void;
  openTask: (id: string, order?: readonly string[]) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  run: <T>(action: () => Promise<T>, options?: RunOptions<T>) => Promise<T | undefined>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp fora do AppShell");
  return value;
}

const isDragging = () => !!document.querySelector(".drag-overlay");

export function refreshAll() {
  return invalidate();
}

export type TaskSelection = { id: string; order: readonly string[] };

type Overlay = {
  quickAdd: QuickAddDefaults | null;
  task: TaskSelection | null;
};

function visibleTaskOrder(id: string) {
  const ids = new Set<string>();
  for (const row of document.querySelectorAll<HTMLElement>("#conteudo [data-task-id]")) {
    if (row.getClientRects().length && !row.closest("[inert]")) ids.add(row.dataset.taskId!);
  }
  return ids.has(id) ? [...ids] : [];
}

export function AppProviders({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

export function AppShell({
  children, renderOverlays, renderChrome,
}: {
  children: ReactNode;
  renderOverlays: (state: Overlay, close: (key: keyof Overlay) => void) => ReactNode;
  renderChrome: (nav: Navigation | undefined) => ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();

  useEffect(() => {
    configureApi({
      onAuthFailure: (code) => {
        clearCache();
        const returnTo = pathname + window.location.search;
        router.replace(code === "PASSWORD_CHANGE_REQUIRED" ? "/trocar-senha" : `/entrar?voltar=${encodeURIComponent(returnTo)}`);
      },
    });
  }, [router, pathname]);

  const me = useQuery<Me>("me", api.me);
  const nav = useQuery<Navigation>(me.data ? "nav" : null, api.navigation);
  if (nav.data) registerTagOrder(nav.data.projects, nav.data.labels.map((label) => label.id));
  useThemeSync(me.data?.preferences.theme);

  useEffect(() => {
    if (me.data?.mustChangePassword) router.replace("/trocar-senha");
  }, [me.data, router]);

  // Revalida ao voltar para a aba e periodicamente, para acompanhar a virada do dia.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void invalidate();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void invalidate(), 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);


  // O editor em linha pertence à tela em que foi aberto.
  useEffect(() => closeEditor(), [pathname]);

  const [overlay, setOverlay] = useState<Overlay>({ quickAdd: null, task: null });
  const close = useCallback((key: keyof Overlay) => setOverlay((current) => ({ ...current, [key]: null })), []);

  const [showProjectShortcuts, setShowProjectShortcuts] = useState(false);
  const switchProject = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.length !== 1) return;
    const project = nav.data?.projects[PROJECT_SHORTCUT_KEYS.indexOf(event.key)];
    if (!project) return;
    event.preventDefault();
    if (!event.repeat && pathname !== `/projetos/${project.id}`) router.push(`/projetos/${project.id}`);
  });

  // Atalhos globais: Q cria, / busca.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true], [role=dialog], .t-editor")) return;
      if (event.key === "q" || event.key === "Q") {
        event.preventDefault();
        setOverlay((current) => ({ ...current, quickAdd: current.quickAdd ?? {} }));
      } else if (event.key === "/") {
        event.preventDefault();
        router.push("/busca");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  // Ctrl + número navega imediatamente. Segurar Ctrl revela os atalhos.
  useEffect(() => {
    let timer: number | undefined;
    const hideShortcuts = () => {
      window.clearTimeout(timer);
      timer = undefined;
      setShowProjectShortcuts(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key === "Control") {
        if (!event.repeat && timer === undefined) {
          timer = window.setTimeout(() => setShowProjectShortcuts(true), PROJECT_SHORTCUT_DELAY_MS);
        }
        return;
      }
      switchProject(event);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!event.ctrlKey && timer !== undefined) hideShortcuts();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("visibilitychange", hideShortcuts);
    window.addEventListener("blur", hideShortcuts);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", hideShortcuts);
      window.removeEventListener("blur", hideShortcuts);
    };
  }, []);

  // Confirmação e campo de texto em diálogo.
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const [promptState, setPromptState] = useState<(PromptOptions & { resolve: (value: string | null) => void }) | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...options, resolve })), []);
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => setPromptState({ ...options, resolve })), []);

  const run = useCallback(async <T,>(action: () => Promise<T>, options: RunOptions<T> = {}) => {
    try {
      const value = await action();
      const notice = typeof options.success === "function" ? options.success(value) : options.success;
      if (typeof notice === "string") {
        if (notice) toast(notice);
      } else if (notice?.message) {
        toast(notice.message, { action: notice.action });
      }
      return value;
    } catch (error) {
      if (error instanceof ApiFailure && (error.code === "UNAUTHENTICATED" || error.code === "PASSWORD_CHANGE_REQUIRED")) return undefined;
      if (error instanceof ApiFailure && error.code === "REVISION_CONFLICT") {
        toast("Este item mudou em outra aba. A tela foi atualizada.", { bad: true });
      } else if (!options.silent) {
        toast(errorMessage(error), { bad: true });
      }
      return undefined;
    } finally {
      void invalidate();
    }
  }, [toast]);

  const value = useMemo<AppContextValue | null>(() => me.data ? {
    me: me.data,
    nav: nav.data,
    showProjectShortcuts,
    reference: nav.data?.referenceDate ?? me.data.referenceDate,
    timezone: me.data.preferences.timezone,
    refresh: () => invalidate(),
    openQuickAdd: (defaults = {}) => setOverlay((current) => ({ ...current, quickAdd: defaults })),
    openTask: (id, order = visibleTaskOrder(id)) => setOverlay((current) => ({ ...current, task: { id, order } })),
    confirm,
    prompt,
    run,
  } : null, [me.data, nav.data, showProjectShortcuts, confirm, prompt, run]);

  if (!value) {
    if (me.error && !(me.error instanceof ApiFailure && me.error.status === 401)) {
      return (
        <div className="empty" style={{ paddingTop: 120 }}>
          <strong>Não foi possível carregar o Feito.</strong>
          {errorMessage(me.error)}
          <div style={{ marginTop: 16 }}><button className="btn" onClick={() => void me.reload()}>Tentar de novo</button></div>
        </div>
      );
    }
    return <Spinner label="Carregando o Feito" />;
  }

  return (
    <AppContext.Provider value={value}>
      <div className="app">
        {renderChrome(nav.data)}
        <Main>{children}</Main>
      </div>
      {renderOverlays(overlay, close)}
      <ConfirmDialog state={confirmState} onDone={(result) => { confirmState?.resolve(result); setConfirmState(null); }} />
      <PromptDialog state={promptState} onDone={(result) => { promptState?.resolve(result); setPromptState(null); }} />
    </AppContext.Provider>
  );
}

/** Área principal: a rota nova entra em fade e os itens de lista animam (docs/04-motion-and-interaction.md). */
function Main({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const main = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);
  useLayoutEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    const duration = motionMs("base");
    if (duration) main.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: "ease-out" });
  }, [pathname]);
  // Pausa durante o arraste: o @dnd-kit mede posições e o FLIP as distorceria.
  useFlip(main, { paused: isDragging });
  return <main ref={main} className="main" id="conteudo">{children}</main>;
}

function ConfirmDialog({ state, onDone }: { state: ConfirmOptions | null; onDone: (value: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={!!state}
      onClose={() => onDone(false)}
      title={state?.title ?? ""}
      initialFocus={cancel}
      footer={(
        <>
          <button ref={cancel} type="button" className="btn ghost" onClick={() => onDone(false)}>Cancelar</button>
          <button type="button" className={`btn ${state?.danger ? "danger" : "primary"}`} onClick={() => onDone(true)}>
            {state?.confirmLabel}
          </button>
        </>
      )}
    >
      {state?.body && <div className="dialog-b" style={{ color: "var(--muted)" }}>{state.body}</div>}
    </Dialog>
  );
}

function PromptDialog({ state, onDone }: { state: PromptOptions | null; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState("");
  useEffect(() => setValue(state?.initial ?? ""), [state]);
  return (
    <Dialog open={!!state} onClose={() => onDone(null)} title={state?.title ?? ""}>
      <form onSubmit={(event) => { event.preventDefault(); if (value.trim()) onDone(value.trim()); }}>
        <div className="dialog-b">
          <div className="field">
            <label htmlFor="prompt-input">{state?.label}</label>
            <input id="prompt-input" className="input" value={value} maxLength={120} data-autofocus
              onChange={(event) => setValue(event.target.value)} />
          </div>
        </div>
        <div className="dialog-f">
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>{state?.confirmLabel}</button>
        </div>
      </form>
    </Dialog>
  );
}

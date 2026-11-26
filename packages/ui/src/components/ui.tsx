"use client";
import { useT } from "./language";

import {
  createContext, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type MouseEventHandler, type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "../client/api";
import { IconCheck, IconX } from "./icons";
import { exitingProps, motionMs, useFlip, usePresence, useSticky } from "./motion";

// ---------- Mídia ----------

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsMobile = () => useMediaQuery("(max-width: 899px)");
/** Ponteiro principal por toque (celulares e tablets): focar um campo abre o teclado na tela. */
export const useIsTouch = () => useMediaQuery("(pointer: coarse)");

// ---------- Foco ----------

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, initial?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = initial?.current ?? node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      // O próprio diálogo recebe o foco quando o Esc sai de um campo: Shift+Tab não pode escapar dele.
      if (event.shiftKey && (document.activeElement === head || document.activeElement === node)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    node?.addEventListener("keydown", onKey);
    return () => {
      node?.removeEventListener("keydown", onKey);
      if (previous?.isConnected && previous !== document.body) previous.focus();
      // O nó continua montado durante a saída: o foco não pode ficar preso nele.
      else if (node?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    };
  }, [active, ref, initial]);
}

// ---------- Diálogo (folha no celular) ----------

const dialogStack: object[] = [];

export function Dialog({
  open, onClose, title, children, footer, wide, labelledBy, initialFocus, hideHeader, width,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  labelledBy?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  hideHeader?: boolean;
  width?: number;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const mobile = useIsMobile();
  // Presença: o diálogo fica montado durante a saída (veja docs/04-motion-and-interaction.md).
  const { mounted, state } = usePresence(open, mobile ? { enter: "slow", exit: "base" } : { enter: "base", exit: "fast" });
  const view = useSticky({ title, children, footer, wide, labelledBy, hideHeader, width }, open);
  useFocusTrap(ref, open, initialFocus);
  useEffect(() => {
    if (!open) return;
    const token = {};
    dialogStack.push(token);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dialogStack[dialogStack.length - 1] === token) {
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      dialogStack.splice(dialogStack.indexOf(token), 1);
    };
  }, [open]);
  if (!mounted) return null;
  return createPortal(
    <div className="dialog-wrap" data-state={state} {...exitingProps(state)}>
      <div className="scrim" onClick={open ? onClose : undefined} />
      <div
        ref={ref}
        className={`pop dialog${view.wide ? " wide" : ""}`}
        style={view.width ? { width: `min(${view.width}px, 100%)` } : undefined}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={view.labelledBy ? undefined : view.title}
        aria-labelledby={view.labelledBy}
      >
        {!view.hideHeader && (
          <div className="dialog-h">
            <h2>{view.title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Fechar (Esc)")}><IconX /></button>
          </div>
        )}
        {view.children}
        {view.footer && <div className="dialog-f">{view.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Popover ancorado ----------

// Popovers abertos, do mais antigo ao mais novo. Um popover aberto a partir de outro (ex.: o calendário
// sobre o menu da tarefa) fica no topo: clicar nele não fecha o de baixo, e Esc/setas só valem para o topo.
const popoverStack: HTMLElement[] = [];

function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const release = () => setTimeout(() => document.removeEventListener("click", swallow, true));
  document.addEventListener("click", swallow, true);
  document.addEventListener("pointerup", release, { capture: true, once: true });
  document.addEventListener("pointercancel", release, { capture: true, once: true });
}

type MenuPoint = { x: number; y: number };

export function Popover({
  anchor, point, open, onClose, children, align = "start", width, label, role = "dialog",
}: {
  anchor: HTMLElement | null;
  point?: MenuPoint;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  width?: number;
  label: string;
  role?: "dialog" | "menu" | "listbox";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  // Presença: o popover fica montado durante a saída (veja docs/04-motion-and-interaction.md).
  const { mounted, state } = usePresence(open, { enter: "base", exit: "fast" });
  const content = useSticky(children, open);
  const close = useEffectEvent(onClose);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!open || !anchor || !node) return;
    const place = () => {
      // A largura precisa estar no DOM antes de medir; senão a 1ª abertura mede o popover largo demais.
      if (width) node.style.width = `${width}px`;
      // Mede na altura natural; --pop-max limita o conteúdo quando nenhum dos lados comporta tudo.
      node.style.removeProperty("--pop-max");
      const rect = point ? { left: point.x, right: point.x, top: point.y, bottom: point.y } : anchor.getBoundingClientRect();
      // As dimensões do layout não incluem a escala da animação de entrada.
      const { offsetWidth: boxWidth, offsetHeight: boxHeight } = node;
      const margin = 8;
      const gap = 6;
      let left = align === "end" ? rect.right - boxWidth : rect.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - boxWidth - margin));
      // Abre abaixo da âncora; senão acima; senão no lado com mais espaço, sem cobrir a âncora.
      const below = window.innerHeight - margin - (rect.bottom + gap);
      const over = rect.top - gap - margin;
      const above = boxHeight > below && (boxHeight <= over || over > below);
      const room = above ? over : below;
      if (boxHeight > room) node.style.setProperty("--pop-max", `${Math.floor(room)}px`);
      const height = Math.min(boxHeight, room);
      const top = above ? Math.max(margin, rect.top - gap - height) : rect.bottom + gap;
      // A escala parte do lado da âncora, inclusive quando o popover vira para cima.
      const placed = { top, left, width, transformOrigin: `${align === "end" ? "right" : "left"} ${above ? "bottom" : "top"}` };
      // Aplica já no DOM: o foco inicial (efeito seguinte) falha num nó ainda com visibility:hidden.
      Object.assign(node.style, { top: `${top}px`, left: `${left}px`, visibility: "" });
      setStyle(placed);
    };
    const onScroll = (event: Event) => {
      // Só reposiciona quando a rolagem pode mover a âncora.
      if (event.target === window || (event.target instanceof Node && event.target.contains(anchor))) place();
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, mounted, anchor, point, align, width]);

  useEffect(() => {
    const node = ref.current;
    if (!open || !node || !anchor) return;
    const first = node.querySelector<HTMLElement>("[data-autofocus]") ?? node.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    popoverStack.push(node);
    const above = () => popoverStack.slice(popoverStack.indexOf(node) + 1);
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (node.contains(target) || anchor.contains(target)) return;
      if (above().some((child) => child.contains(target))) return;
      // Clique num popover de baixo (ex.: o menu sob o calendário) só fecha este: o clique não aciona nada lá.
      const below = popoverStack.slice(0, popoverStack.indexOf(node));
      if (below.some((parent) => parent.contains(target))) swallowNextClick();
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (above().length) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        anchor.focus();
      }
      if (role === "menu" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const items = [...node.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')];
        const index = items.indexOf(document.activeElement as HTMLElement);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const next = index < 0 ? items.at(direction === 1 ? 0 : -1)
          : items[(index + direction + items.length) % items.length];
        next?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      popoverStack.splice(popoverStack.indexOf(node), 1);
    };
  }, [open, anchor, role]);

  if (!mounted) return null;
  return createPortal(
    <div ref={ref} className="pop popover" style={style} role={role} aria-label={label} data-state={state} {...exitingProps(state)}>
      {content}
    </div>,
    document.body,
  );
}

export type MenuChoice = { label: string; icon: ReactNode; active?: boolean; className?: string } & (
  | { onSelect: () => void }
  /** Abre um popover ancorado na opção, por cima do menu, que continua aberto. `close` fecha os dois. */
  | { popover: (close: () => void) => ReactNode }
);

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
} | "separator" | {
  /** Grupo com título e uma fileira de opções em ícone (ex.: datas rápidas, prioridades). */
  kind: "choices";
  label: string;
  options: MenuChoice[];
};

function MenuEntries({ items, onClose, large }: { items: MenuItem[]; onClose: () => void; large?: boolean }) {
  const [sub, setSub] = useState<{ label: string; anchor: HTMLElement } | null>(null);
  const closeSub = useCallback(() => setSub(null), []);
  const subOption = sub && items.flatMap((item) => (item !== "separator" && "kind" in item ? item.options : []))
    .find((option) => option.label === sub.label);
  return (
    <>
      {items.map((item, index) => {
        if (item === "separator") return <div key={`s${index}`} className="msep" role="separator" />;
        if ("kind" in item) {
          return (
            <div key={`c${item.label}`} role="group" aria-label={item.label} className={`mgroup${large ? " large" : ""}`}>
              <div className="mgroup-h" aria-hidden="true">{item.label}</div>
              <div className="mchoices">
                {item.options.map((option) => (
                  <button key={option.label} type="button" role="menuitemradio" aria-checked={!!option.active}
                    aria-label={option.label} data-tooltip={option.label} className={`mchoice ${option.className ?? ""}`}
                    aria-haspopup={"popover" in option ? "dialog" : undefined}
                    aria-expanded={"popover" in option ? sub?.label === option.label : undefined}
                    onClick={(event) => {
                      if ("popover" in option) {
                        const anchor = event.currentTarget;
                        setSub((current) => (current?.label === option.label ? null : { label: option.label, anchor }));
                        return;
                      }
                      onClose();
                      option.onSelect();
                    }}>
                    {option.icon}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`mi${item.danger ? " danger" : ""}`}
            style={large ? { minHeight: 48, fontSize: 15 } : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon}
            <span style={{ flex: 1 }}>{item.label}</span>
            {!large && item.shortcut && <span className="kbd">{item.shortcut}</span>}
          </button>
        );
      })}
      <Popover anchor={sub?.anchor ?? null} open={!!subOption && "popover" in subOption} onClose={closeSub}
        label={sub?.label ?? ""} align="end">
        {subOption && "popover" in subOption && subOption.popover(() => { closeSub(); onClose(); })}
      </Popover>
    </>
  );
}

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return <div className="menu"><MenuEntries items={items} onClose={onClose} /></div>;
}

const ContextMenus = createContext(false);
export const ContextMenusProvider = ContextMenus.Provider;

export function useContextMenu(enabled = true) {
  const supported = useContext(ContextMenus);
  const [activation, setActivation] = useState<{ point?: MenuPoint } | null>(null);
  const close = useCallback(() => setActivation(null), []);
  const handle: MouseEventHandler<HTMLElement> = (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target)
      || target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    const point = event.button === 2 || event.ctrlKey ? { x: event.clientX, y: event.clientY } : undefined;
    setActivation({ point });
  };
  return { activation, close, onContextMenu: supported && enabled ? handle : undefined };
}

/** Botão que abre um menu de ações (popover no desktop, folha no celular). */
export function MenuButton({
  label, items, children, className = "icon-btn", title, tooltip, contextMenu,
}: {
  label: string;
  /** Dica nativa do botão no hover. */
  tooltip?: string;
  items: () => MenuItem[];
  children: ReactNode;
  className?: string;
  title?: string;
  contextMenu?: ReturnType<typeof useContextMenu>;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [buttonOpen, setButtonOpen] = useState(false);
  const mobile = useIsMobile();
  const closeContextMenu = contextMenu?.close;
  const close = useCallback(() => {
    // Um diálogo aberto pela ação deve registrar o botão como retorno, não o item temporário do menu.
    anchor?.focus();
    setButtonOpen(false);
    closeContextMenu?.();
  }, [anchor, closeContextMenu]);
  const open = buttonOpen || !!contextMenu?.activation;
  const point = contextMenu?.activation?.point;
  const list = open ? items() : [];
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className={className}
        aria-label={label}
        data-tooltip={tooltip}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close();
          else setButtonOpen(true);
        }}
        onContextMenu={contextMenu?.onContextMenu}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </button>
      {mobile ? (
        <Dialog open={open} onClose={close} title={title ?? label}>
          <div style={{ padding: "4px 10px 18px" }}>
            <div className="menu" role="menu" aria-label={title ?? label}>
              <MenuEntries items={list} onClose={close} large />
            </div>
          </div>
        </Dialog>
      ) : (
        <Popover anchor={anchor} point={point} open={open} onClose={close} label={title ?? label} role="menu" align={point ? "start" : "end"}>
          <MenuList items={list} onClose={close} />
        </Popover>
      )}
    </>
  );
}

// ---------- Avisos ----------

export type ToastAction = { label: string; onClick: () => void };
export type ToastOptions = { bad?: boolean; action?: ToastAction };
type Toast = { id: number; message: string; bad: boolean; action?: ToastAction; leaving: boolean };
const TOAST_MS = 3200;
const TOAST_LIMIT = 3;
const ToastContext = createContext<(message: string, options?: ToastOptions) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const stack = useRef<HTMLDivElement>(null);
  useFlip(stack);
  // Saída em duas etapas: marca `leaving` (fade pelo CSS) e só remove depois da duração de saída.
  const dismiss = useCallback((ids: number[]) => {
    if (!ids.length) return;
    setToasts((current) => current.map((toast) => (ids.includes(toast.id) ? { ...toast, leaving: true } : toast)));
    window.setTimeout(() => setToasts((current) => current.filter((toast) => !ids.includes(toast.id))), motionMs("base"));
  }, []);
  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const id = ++next.current;
    setToasts((current) => {
      const visible = current.filter((toast) => !toast.leaving);
      const overflow = visible.slice(0, Math.max(0, visible.length - (TOAST_LIMIT - 1))).map((toast) => toast.id);
      if (overflow.length) queueMicrotask(() => dismiss(overflow));
      return [...current, { id, message, bad: !!options.bad, action: options.action, leaving: false }];
    });
    window.setTimeout(() => dismiss([id]), TOAST_MS);
  }, [dismiss]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div ref={stack} className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast${toast.bad ? " bad" : ""}`} style={{ paddingRight: toast.action ? 8 : 14 }}
            data-flip={`toast:${toast.id}`} data-state={toast.leaving ? "exiting" : "entered"} {...exitingProps(toast.leaving ? "exiting" : "entered")}>
            {toast.bad ? null : <IconCheck aria-hidden="true" />}
            {toast.message}
            {toast.action && <button type="button" className="btn" onClick={() => {
              dismiss([toast.id]);
              toast.action?.onClick();
            }}>{toast.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return <div className="loading" role="status" aria-label={label ?? t("Carregando")}><div className="spinner" /></div>;
}

export function ReadFallback({ error, loading, onRetry }: { error: unknown; loading: boolean; onRetry: () => void }) {
  const t = useT();
  if (!error) return <Spinner />;
  return (
    <div className="empty">
      <strong role="alert">{errorMessage(error)}</strong>
      <button type="button" className="btn" disabled={loading} onClick={onRetry}>{t("Tentar de novo")}</button>
    </div>
  );
}

/** Faz um textarea crescer com o texto: a altura acompanha o conteúdo, sem alça de redimensionar. */
export function useAutoGrow(value: string) {
  const node = useRef<HTMLTextAreaElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const fit = useCallback(() => {
    const element = node.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, []);
  useLayoutEffect(fit, [value, fit]);
  // Ref de callback: o campo pode montar depois do diálogo (após carregar a tarefa).
  return useCallback((element: HTMLTextAreaElement | null) => {
    observer.current?.disconnect();
    node.current = element;
    if (!element) return;
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let width = element.clientWidth;
    observer.current = new ResizeObserver(() => {
      if (element.clientWidth !== width) { width = element.clientWidth; fit(); }
    });
    observer.current.observe(element);
  }, [fit]);
}

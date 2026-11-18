"use client";
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconX } from "./icons";

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
      if (event.shiftKey && document.activeElement === head) {
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
      if (previous?.isConnected) previous.focus();
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
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
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
  if (!open) return null;
  return createPortal(
    <div className="dialog-wrap">
      <div className="scrim" onClick={onClose} />
      <div
        ref={ref}
        className={`pop dialog${wide ? " wide" : ""}`}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
      >
        {!hideHeader && (
          <div className="dialog-h">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar (Esc)"><IconX /></button>
          </div>
        )}
        {children}
        {footer && <div className="dialog-f">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Popover ancorado ----------

export function Popover({
  anchor, open, onClose, children, align = "start", width, label, role = "dialog",
}: {
  anchor: HTMLElement | null;
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

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const box = ref.current!.getBoundingClientRect();
      const margin = 8;
      let left = align === "end" ? rect.right - box.width : rect.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
      let top = rect.bottom + 6;
      if (top + box.height > window.innerHeight - margin) top = Math.max(margin, rect.top - box.height - 6);
      setStyle({ top, left, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, align, width]);

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (node?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        anchor?.focus();
      }
      if (role === "menu" && (event.key === "ArrowDown" || event.key === "ArrowUp") && node) {
        event.preventDefault();
        const items = [...node.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        next?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchor, role]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} className="pop popover" style={style} role={role} aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
} | "separator";

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div className="menu">
      {items.map((item, index) => item === "separator"
        ? <div key={`s${index}`} className="msep" role="separator" />
        : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`mi${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon}
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && <span className="kbd">{item.shortcut}</span>}
          </button>
        ))}
    </div>
  );
}

/** Botão que abre um menu de ações (popover no desktop, folha no celular). */
export function MenuButton({
  label, items, children, className = "icon-btn", title,
}: {
  label: string;
  items: () => MenuItem[];
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const close = useCallback(() => setOpen(false), []);
  const list = open ? items() : [];
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </button>
      {mobile ? (
        <Dialog open={open} onClose={close} title={title ?? label}>
          <div style={{ padding: "4px 10px 18px" }}>
            <div className="menu" role="menu" aria-label={title ?? label}>
              {list.map((item, index) => item === "separator"
                ? <div key={`s${index}`} className="msep" role="separator" />
                : (
                  <button key={item.label} type="button" role="menuitem" className={`mi${item.danger ? " danger" : ""}`}
                    style={{ minHeight: 48, fontSize: 15 }} disabled={item.disabled}
                    onClick={() => { close(); item.onSelect(); }}>
                    {item.icon}<span style={{ flex: 1 }}>{item.label}</span>
                  </button>
                ))}
            </div>
          </div>
        </Dialog>
      ) : (
        <Popover anchor={anchor} open={open} onClose={close} label={title ?? label} role="menu" align="end">
          <MenuList items={list} onClose={close} />
        </Popover>
      )}
    </>
  );
}

// ---------- Avisos ----------

type Toast = { id: number; message: string; bad: boolean };
const ToastContext = createContext<(message: string, options?: { bad?: boolean }) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback((message: string, options: { bad?: boolean } = {}) => {
    const id = ++next.current;
    setToasts((current) => [...current.slice(-2), { id, message, bad: !!options.bad }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast${toast.bad ? " bad" : ""}`} style={{ paddingRight: 14 }}>
            {toast.bad ? null : <IconCheck />}
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function Spinner({ label = "Carregando" }: { label?: string }) {
  return <div className="loading" role="status" aria-label={label}><div className="spinner" /></div>;
}

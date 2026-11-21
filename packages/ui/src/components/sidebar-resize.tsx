"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "./language";

const STORAGE_KEY = "feito:sidebar-width";
const DEFAULT_WIDTH = 264;

/** A largura também alinha a faixa de título do desktop. Só a preferência visual é persistida. */
export function useSidebarResize() {
  const t = useT();
  const sidebar = useRef<HTMLElement>(null);
  const resizeHandle = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(DEFAULT_WIDTH);
  const [limits, setLimits] = useState({ min: 224, max: 440 });
  const drag = useRef<{ x: number; width: number; currentWidth: number } | null>(null);
  const width = Math.max(limits.min, Math.min(limits.max, preferred));

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) setPreferred(saved);
    } catch { /* A navegação continua disponível sem armazenamento. */ }
    const nav = sidebar.current!;
    const button = nav.querySelector<HTMLElement>(".side-add")!;
    const label = button.querySelector<HTMLElement>(".side-add-label")!;
    const measure = () => {
      if (!nav.getBoundingClientRect().width) return;
      const navStyle = getComputedStyle(nav);
      const buttonStyle = getComputedStyle(button);
      const children = Array.from(button.children, (child) => (child as HTMLElement).scrollWidth);
      const min = Math.max(224, Math.ceil(
        children.reduce((sum, size) => sum + size, 0)
        + parseFloat(buttonStyle.columnGap) * (children.length - 1)
        + parseFloat(buttonStyle.paddingLeft) + parseFloat(buttonStyle.paddingRight)
        + parseFloat(navStyle.paddingLeft) + parseFloat(navStyle.paddingRight)
        + 13, // Borda e espaço para a barra de rolagem.
      ));
      const max = Math.max(min, Math.min(440, Math.floor(window.innerWidth * .45)));
      setLimits((previous) => previous.min === min && previous.max === max ? previous : { min, max });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    observer.observe(label);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  }, [width]);

  useEffect(() => () => {
    document.documentElement.style.removeProperty("--sidebar-width");
    document.documentElement.classList.remove("sidebar-resizing");
  }, []);

  const persistWidth = (next: number) => {
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* Preferência opcional. */ }
  };
  const resize = (next: number, persist = true) => {
    const clamped = Math.round(Math.max(limits.min, Math.min(limits.max, next)));
    // A geometria acompanha o evento; a renderização React atualiza o valor acessível.
    document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
    setPreferred(clamped);
    if (drag.current) drag.current.currentWidth = clamped;
    if (persist) persistWidth(clamped);
  };
  const finishDrag = () => {
    if (drag.current) {
      persistWidth(drag.current.currentWidth);
      resizeHandle.current?.blur();
    }
    drag.current = null;
    document.documentElement.classList.remove("sidebar-resizing");
  };

  const handle = <div
    ref={resizeHandle}
    className="sidebar-resize" role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={t("Redimensionar menu lateral")} title={t("Arraste ou use as setas para redimensionar")}
    aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={width}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width, currentWidth: width };
      document.documentElement.classList.add("sidebar-resizing");
    }}
    onPointerMove={(event) => {
      if (drag.current) resize(drag.current.width + event.clientX - drag.current.x, false);
    }}
    onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      finishDrag();
    }}
    onLostPointerCapture={finishDrag}
    onPointerCancel={finishDrag}
    onDoubleClick={() => resize(DEFAULT_WIDTH)}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 32 : 8;
      const next = event.key === "ArrowLeft" ? width - step : event.key === "ArrowRight" ? width + step
        : event.key === "Home" ? limits.min : event.key === "End" ? limits.max : undefined;
      if (next === undefined) return;
      event.preventDefault();
      resize(next);
    }}
  />;
  return { sidebar, handle };
}

export function SidebarName({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const element = ref.current!;
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [children]);
  return <span ref={ref} className={`nav-name${truncated ? " nav-name-truncated" : ""}`} title={children}>{children}</span>;
}

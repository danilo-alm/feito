"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { exitingProps, usePresence, useSticky } from "./motion";

const HOVER_DELAY = 320;
const CROSSING_DELAY = 80;
const GAP = 6;
const EDGE = 8;

type Tip = { anchor: HTMLElement; text: string };

function trigger(target: EventTarget | null) {
  const anchor = target instanceof Element ? target.closest("[data-tooltip]") : null;
  return anchor instanceof HTMLElement && !anchor.closest('[inert], [aria-hidden="true"]') ? anchor : null;
}

/** Um único tooltip para os controles da interface, inclusive os que ficam em portais. */
export function TooltipLayer() {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const { mounted, state } = usePresence(!!tip, { enter: "base", exit: "fast" });
  const content = useSticky(tip, !!tip);

  useEffect(() => {
    let hovered: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    let showing: Tip | null = null;
    let timer: number | undefined;

    const show = (anchor: HTMLElement | null) => {
      const text = anchor?.dataset.tooltip;
      if (anchor && text && anchor.isConnected && trigger(anchor) === anchor && anchor.getClientRects().length) {
        if (!showing) observer.observe(document.body, {
          childList: true, subtree: true, attributes: true, attributeFilter: ["data-tooltip", "aria-hidden", "inert"],
        });
        showing = { anchor, text };
        setTip(showing);
      } else {
        observer.disconnect();
        showing = null;
        setTip(null);
      }
    };

    const update = (delay: number) => {
      window.clearTimeout(timer);
      const anchor = hovered ?? focused;
      if (anchor === (showing?.anchor ?? null)) return;
      if (anchor && showing && delay) show(null);
      if (!delay) show(anchor);
      else timer = window.setTimeout(() => show(anchor), delay);
    };

    const dismiss = () => {
      hovered = focused = null;
      update(0);
    };

    const isPanel = (target: EventTarget | null) => target instanceof Node && panel.current?.contains(target);
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.buttons) return;
      if (isPanel(event.target) && showing) {
        hovered = showing.anchor;
        update(0);
        return;
      }
      const anchor = trigger(event.target);
      if (anchor === hovered) return;
      hovered = anchor;
      update(anchor ? HOVER_DELAY : 0);
    };
    const onOut = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !hovered) return;
      if (trigger(event.relatedTarget) === hovered || isPanel(event.relatedTarget)) return;
      hovered = null;
      // Dá tempo para cruzar o espaço entre o controle e o balão.
      update(showing ? CROSSING_DELAY : 0);
    };
    const onFocus = (event: FocusEvent) => {
      const anchor = trigger(event.target);
      focused = anchor?.matches(":focus-visible") ? anchor : null;
      if (focused) {
        hovered = null;
        update(0);
      }
    };
    const onBlur = () => {
      if (focused) {
        focused = null;
        update(0);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const onChange = () => {
      if (!showing) return;
      const { anchor, text } = showing;
      if (!anchor.isConnected || !anchor.dataset.tooltip || trigger(anchor) !== anchor) dismiss();
      else if (anchor.dataset.tooltip !== text) show(anchor);
    };

    const observer = new MutationObserver(onChange);
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, []);

  useLayoutEffect(() => {
    const node = panel.current;
    if (!tip || !node) return;
    const { anchor, text } = tip;
    const rect = anchor.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const below = rect.bottom + GAP + height + EDGE <= clientHeight || rect.top < height + GAP + EDGE;
    const top = below ? rect.bottom + GAP : rect.top - GAP - height;
    const left = rect.left + (rect.width - width) / 2;
    node.style.left = `${Math.max(EDGE, Math.min(left, clientWidth - width - EDGE))}px`;
    node.style.top = `${Math.max(EDGE, Math.min(top, clientHeight - height - EDGE))}px`;
    node.dataset.side = below ? "below" : "above";

    if (text === anchor.getAttribute("aria-label") || text === anchor.getAttribute("aria-description")) return;
    const descriptions = () => (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    anchor.setAttribute("aria-describedby", [...descriptions(), id].join(" "));
    return () => {
      const remaining = descriptions().filter((value) => value !== id);
      if (remaining.length) anchor.setAttribute("aria-describedby", remaining.join(" "));
      else anchor.removeAttribute("aria-describedby");
    };
  }, [id, tip]);

  if (!mounted || !content) return null;
  return createPortal(
    <div ref={panel} id={id} className="tooltip" role="tooltip" data-state={state} {...exitingProps(state)}>
      {content.text}
    </div>,
    document.body,
  );
}

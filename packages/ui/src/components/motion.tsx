"use client";
// Mecanismo de movimento do Feito: nada aparece ou some sem transição.
// Padrão obrigatório para toda tela nova; leia docs/04-motion-and-interaction.md antes de mudar.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { MOTION_FALLBACK_MS, nextPresence, parseDuration, type MotionToken, type PresenceState } from "../client/presence";

export type { MotionToken, PresenceState };

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Duração de um token (`--dur-fast|base|slow`) lida do CSS; 0 com movimento reduzido ou no servidor. */
export function motionMs(token: MotionToken) {
  if (typeof window === "undefined" || prefersReducedMotion()) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--dur-${token}`);
  return parseDuration(raw, MOTION_FALLBACK_MS[token]);
}

function easing(name: "out" | "in" | "in-out") {
  const raw = typeof window === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(`--ease-${name}`).trim();
  return raw || "ease-out";
}

/**
 * Mantém um elemento montado enquanto ele sai. Devolve `mounted` (renderizar ou não) e `state`
 * (`entering | entered | exiting`), para ser posto em `data-state` e animado pelo CSS.
 * Com `appear: false`, um elemento que já nasce aberto não anima a entrada (evita deslocamento no carregamento).
 */
export function usePresence(open: boolean, { enter = "base", exit = "fast", appear = true }: {
  enter?: MotionToken; exit?: MotionToken; appear?: boolean;
} = {}) {
  const [state, setState] = useState<PresenceState>(() => (open ? (appear ? "entering" : "entered") : "unmounted"));
  const [last, setLast] = useState(open);
  if (last !== open) {
    setLast(open);
    setState((current) => nextPresence(current, open ? "open" : "close", { instantExit: motionMs(exit) === 0 }));
  }
  useEffect(() => {
    if (state !== "entering" && state !== "exiting") return;
    // Timeout em vez de `transitionend`: o evento não dispara com transições desligadas.
    const ms = motionMs(state === "entering" ? enter : exit);
    const timer = window.setTimeout(() => setState((current) => nextPresence(current, "settled")), ms + 16);
    return () => window.clearTimeout(timer);
  }, [state, enter, exit]);
  return { mounted: state !== "unmounted", state: (state === "unmounted" ? "exiting" : state) as Exclude<PresenceState, "unmounted"> };
}

/** Valor do último render em que `live` era verdadeiro: o conteúdo que está saindo não muda nem esvazia. */
export function useSticky<T>(value: T, live: boolean): T {
  const ref = useRef(value);
  if (live) ref.current = value;
  return live ? value : ref.current;
}

/** Atributos para o nó que está saindo: não recebe cliques, foco nem leitura por tecnologia assistiva. */
export function exitingProps(state: PresenceState) {
  return state === "exiting" ? { inert: true, "aria-hidden": true } as const : {};
}

/** Bloco recolhível: anima a altura (grid-template-rows 0fr → 1fr) e a opacidade. */
export function Collapse({ open, children, appear = true, className = "" }: {
  open: boolean; children: ReactNode; appear?: boolean; className?: string;
}) {
  const { mounted, state } = usePresence(open, { enter: "base", exit: "fast", appear });
  const content = useSticky(children, open);
  if (!mounted) return null;
  return (
    <div className={`collapse ${className}`.trim()} data-state={state} {...exitingProps(state)}>
      <div className="collapse-in">{content}</div>
    </div>
  );
}

// ---------- Listas (FLIP) ----------

type Snapshot = { node: HTMLElement; x: number; y: number; rect: DOMRect };

const FLIP_SELECTOR = "[data-flip],[data-task-id]";
const flipKey = (node: HTMLElement) => node.dataset.flip ?? node.dataset.taskId;
const MAX_GHOSTS = 8;

const origins = new Map<string, { rect: DOMRect; opacity: number; at: number }>();

/**
 * Ao soltar um arraste, o próximo FLIP parte da posição e da opacidade atuais da prévia.
 */
export function flipFrom(key: string, preview: HTMLElement | null) {
  if (!preview || prefersReducedMotion()) return;
  origins.set(key, {
    rect: preview.getBoundingClientRect(),
    opacity: Number(getComputedStyle(preview).opacity),
    at: performance.now(),
  });
}

/** Posição no layout, sem rolagem nem transform: comparável entre mudanças mesmo durante uma animação. */
function layoutOffset(node: HTMLElement) {
  let x = 0;
  let y = 0;
  for (let current: HTMLElement | null = node; current; current = current.offsetParent as HTMLElement | null) {
    x += current.offsetLeft;
    y += current.offsetTop;
  }
  return { x, y };
}

function ghostLayer() {
  let layer = document.getElementById("flip-ghosts");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "flip-ghosts";
    layer.setAttribute("aria-hidden", "true");
    layer.inert = true;
    document.body.append(layer);
  }
  return layer;
}

function snapshot(root: HTMLElement) {
  const map = new Map<string, Snapshot>();
  for (const node of root.querySelectorAll<HTMLElement>(FLIP_SELECTOR)) {
    const key = flipKey(node);
    if (key && !map.has(key)) map.set(key, { node, ...layoutOffset(node), rect: node.getBoundingClientRect() });
  }
  return map;
}

/** Quanto a tela rolou desde a última foto, pelo vizinho sobrevivente mais próximo (mesmo contêiner de rolagem). */
function scrollDelta(before: Snapshot, previous: Map<string, Snapshot>, next: Map<string, Snapshot>) {
  let best: { distance: number; dx: number; dy: number } | null = null;
  for (const [key, then] of previous) {
    const now = next.get(key);
    if (!now) continue;
    const distance = Math.abs(then.y - before.y) + Math.abs(then.x - before.x);
    if (best && distance >= best.distance) continue;
    best = {
      distance,
      dx: now.rect.left - then.rect.left - (now.x - then.x),
      dy: now.rect.top - then.rect.top - (now.y - then.y),
    };
  }
  return best ?? { dx: 0, dy: 0 };
}

/**
 * Anima itens de lista que entram, mudam de lugar ou saem. Observa o DOM de `ref` (MutationObserver),
 * então cobre qualquer tela renderizada dentro dele sem ajuste por componente. Itens são reconhecidos
 * por `data-flip` ou `data-task-id`. Quem sai vira um "fantasma" fixo que esmaece enquanto os vizinhos
 * deslizam para o espaço. Desligado com movimento reduzido e enquanto `paused()` for verdadeiro
 * (por exemplo, durante um arraste, quando a biblioteca de arraste mede as posições).
 */
export function useFlip(ref: RefObject<HTMLElement | null>, { paused }: { paused?: () => boolean } = {}) {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const running = new WeakMap<HTMLElement, Animation>();
    let previous = snapshot(root);
    let path = location.pathname;

    const step = () => {
      if (pausedRef.current?.()) return;
      const next = snapshot(root);
      const before = previous;
      previous = next;
      // Outra rota: o conteúdo inteiro mudou e já entra com o fade do AppShell.
      if (location.pathname !== path) {
        path = location.pathname;
        return;
      }
      const duration = motionMs("base");
      if (!duration || !before.size) return;
      // Lista trocada por inteiro (outro projeto, outra semana): sem fantasmas nem deslizes.
      if (![...next.keys()].some((key) => before.has(key))) return;

      const hints = new Map([...origins].filter(([, hint]) => performance.now() - hint.at < 1000));
      origins.clear();
      for (const [key, now] of next) {
        const then = before.get(key);
        const node = now.node;
        const hint = hints.get(key);
        if (hint) {
          running.get(node)?.cancel();
          running.set(node, node.animate(
            [{ transform: `translate(${hint.rect.left - now.rect.left}px, ${hint.rect.top - now.rect.top}px)` }, { transform: "none" }],
            { duration: motionMs("slow"), easing: easing("out") },
          ));
          // Atualizações do layout podem interromper o deslize sem interromper a opacidade.
          if (hint.opacity < 1) {
            node.animate([{ opacity: hint.opacity }, { opacity: 1 }], { duration, easing: easing("in-out") });
          }
          continue;
        }
        if (!then) {
          // Quem tem `data-state` cuida da própria entrada (usePresence + CSS).
          if (node.dataset.state) continue;
          node.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration, easing: easing("out") });
          continue;
        }
        let dx = then.x - now.x;
        let dy = then.y - now.y;
        const current = running.get(node);
        if (current?.playState === "running") {
          // Interrompido no meio: parte de onde o item está na tela, sem salto.
          const transform = getComputedStyle(node).transform;
          const matrix = new DOMMatrixReadOnly(transform === "none" ? undefined : transform);
          dx += matrix.m41;
          dy += matrix.m42;
          current.cancel();
        }
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        running.set(node, node.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
          { duration: motionMs("slow"), easing: easing("in-out") },
        ));
      }

      let ghosts = 0;
      for (const [key, then] of before) {
        // Nós com presença própria (data-state) já saíram animados; não ganham fantasma.
        if (next.has(key) || then.node.isConnected || then.node.dataset.state || ghosts >= MAX_GHOSTS) continue;
        ghosts += 1;
        const ghost = then.node.cloneNode(true) as HTMLElement;
        for (const attribute of ["data-task-id", "data-flip", "id"]) ghost.removeAttribute(attribute);
        ghost.classList.add("flip-ghost");
        const shift = scrollDelta(then, before, next);
        Object.assign(ghost.style, {
          top: `${then.rect.top + shift.dy}px`, left: `${then.rect.left + shift.dx}px`,
          width: `${then.rect.width}px`, height: `${then.rect.height}px`,
        });
        ghostLayer().append(ghost);
        const exit = motionMs("fast");
        const remove = () => ghost.remove();
        const fade = ghost.animate(
          [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.98)" }],
          { duration: exit, easing: easing("in"), fill: "forwards" },
        );
        fade.onfinish = remove;
        fade.oncancel = remove;
        window.setTimeout(remove, exit + 100);
      }
    };

    // O callback roda como microtarefa depois do commit do React e antes da pintura.
    const observer = new MutationObserver(step);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    const refresh = () => { previous = snapshot(root); };
    window.addEventListener("resize", refresh);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", refresh);
    };
  }, [ref]);
}

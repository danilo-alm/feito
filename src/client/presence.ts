// Máquina de estados da presença: um elemento que aparece ou some fica montado durante a saída.
// Padrão obrigatório do app; veja docs/04-motion-and-interaction.md.

export type PresenceState = "entering" | "entered" | "exiting" | "unmounted";
export type PresenceEvent = "open" | "close" | "settled";

/**
 * Próximo estado da presença.
 * - `open` reaproveita o nó que estiver saindo (reabrir durante a saída não duplica nem pisca).
 * - `close` com `instantExit` (movimento reduzido, duração zero) desmonta na hora.
 * - `settled` é o fim do tempo da animação, medido por timeout e nunca por `transitionend`.
 */
export function nextPresence(state: PresenceState, event: PresenceEvent, options: { instantExit?: boolean } = {}): PresenceState {
  switch (event) {
    case "open":
      return state === "entered" ? "entered" : "entering";
    case "close":
      if (state === "unmounted") return "unmounted";
      return options.instantExit ? "unmounted" : "exiting";
    case "settled":
      if (state === "entering") return "entered";
      if (state === "exiting") return "unmounted";
      return state;
  }
}

export type MotionToken = "fast" | "base" | "slow";

/** Valores padrão dos tokens de `:root` em globals.css (usados se o CSS não puder ser lido). */
export const MOTION_FALLBACK_MS: Record<MotionToken, number> = { fast: 120, base: 180, slow: 260 };

/** Converte o valor de uma custom property de duração ("180ms", ".18s") em milissegundos. */
export function parseDuration(raw: string, fallback: number) {
  const value = raw.trim();
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  if (value.endsWith("ms")) return number;
  if (value.endsWith("s")) return number * 1000;
  return number;
}

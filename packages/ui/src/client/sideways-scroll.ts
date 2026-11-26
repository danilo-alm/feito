import { useCallback, type RefObject } from "react";

/**
 * Rola um campo de uma linha com o trackpad ou com Shift + roda do mouse. O WebKit (app de macOS e Linux,
 * Safari) não faz isso sozinho: sem este código, o resto do texto só aparece movendo o cursor.
 * Serve direto como ref do campo e devolve a limpeza.
 */
export function sidewaysScroll(field: HTMLInputElement | null) {
  if (!field) return;
  const onWheel = (event: WheelEvent) => {
    // Gestos mais verticais que horizontais continuam rolando a página ou o diálogo; Ctrl é zoom.
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (!delta || event.ctrlKey || field.scrollWidth <= field.clientWidth) return;
    // Sem isto, o Chromium rolaria o campo duas vezes e o quadro em volta andaria junto.
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? field.clientWidth : 1;
    field.scrollLeft += delta * unit;
  };
  field.addEventListener("wheel", onWheel, { passive: false });
  return () => field.removeEventListener("wheel", onWheel);
}

/** `sidewaysScroll` para um campo que também precisa de uma ref. */
export function useSidewaysScroll(ref: RefObject<HTMLInputElement | null>) {
  return useCallback((field: HTMLInputElement | null) => {
    ref.current = field;
    const detach = sidewaysScroll(field);
    return () => {
      detach?.();
      ref.current = null;
    };
  }, [ref]);
}

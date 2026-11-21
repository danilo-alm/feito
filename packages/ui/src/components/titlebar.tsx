"use client";
import { createContext, useContext } from "react";

/**
 * Faixa de título desenhada pelo app (desktop). Quando existe, o PageHeader
 * leva ferramentas e título compacto para ela em vez de desenhar a topbar e o m-top.
 */
export type TitlebarSlots = {
  /** Destino das ferramentas da tela. */
  tools: HTMLElement | null;
  /** Destino do título compacto. */
  title: HTMLElement | null;
  /** O conteúdo da rota atual já passou por baixo da faixa. */
  scrolled: boolean;
};

export const TitlebarContext = createContext<TitlebarSlots | null>(null);

export function useTitlebar() {
  return useContext(TitlebarContext);
}

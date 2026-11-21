"use client";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { getLocale, restoreLocale, serverLocale, subscribeLocale, translate } from "../client/locale";

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, serverLocale);
}
export function useT() {
  const locale = useLocale();
  return useCallback((message: string, values?: readonly (string | number | null | undefined)[]) => translate(message, values, locale), [locale]);
}
export function LanguageProvider({ children }: { children: ReactNode }) {
  useEffect(restoreLocale, []);
  return children;
}
export function SkipToContent() {
  const t = useT();
  return <a href="#conteudo" className="sr-only" onClick={(event) => {
    const main = document.getElementById("conteudo");
    if (!main) return;
    event.preventDefault();
    main.tabIndex = -1;
    main.focus();
  }}>{t("Pular para o conteúdo")}</a>;
}

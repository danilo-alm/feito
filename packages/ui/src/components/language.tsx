"use client";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { getLocale, restoreLocale, serverLocale, subscribeLocale, translate } from "../client/locale";
import { Spinner } from "./ui";

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, serverLocale);
}
export function useT() {
  const locale = useLocale();
  return useCallback((message: string, values?: readonly (string | number | null | undefined)[]) => translate(message, values, locale), [locale]);
}
export function LanguageLoadError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return <div className="empty">
    <strong role="alert">{t("Não foi possível carregar o Feito.")}</strong>
    <button type="button" className="btn" onClick={onRetry}>{t("Tentar de novo")}</button>
  </div>;
}
export function LanguageProvider({ children, wait = false }: { children: ReactNode; wait?: boolean }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus("loading");
    void restoreLocale().then(() => { if (active) setStatus("ready"); }, () => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [attempt]);
  if (wait && status !== "ready") return status === "error"
    ? <LanguageLoadError onRetry={() => setAttempt((value) => value + 1)} />
    : <Spinner />;
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

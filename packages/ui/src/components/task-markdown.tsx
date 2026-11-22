"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { getMarkdown, loadMarkdown, serverMarkdown, subscribeMarkdown } from "../client/markdown";
import { useT } from "./language";

function useMarkdown(enabled: boolean) {
  const state = useSyncExternalStore(subscribeMarkdown, getMarkdown, serverMarkdown);
  useEffect(() => {
    if (enabled) void loadMarkdown().catch(() => undefined);
  }, [enabled]);
  return state;
}

/** O texto continua legível e editável enquanto o formatador carrega. */
export function TaskMarkdown({ children }: { children: string }) {
  const t = useT();
  const state = useMarkdown(Boolean(children));
  const content = useRef<HTMLDivElement>(null);
  if (!children) return null;
  return <div ref={content} className="task-markdown" tabIndex={-1} aria-busy={!state.renderer && state.status !== "error"}>
    {state.renderer ? <state.renderer.TaskMarkdown>{children}</state.renderer.TaskMarkdown> : <>
      <p>{children}</p>
      {state.status === "error" ? <div className="hint">
        <span role="alert">{t("Não foi possível formatar a descrição.")}</span>{" "}
        <button type="button" className="btn" onClick={(event) => {
          event.stopPropagation();
          const preview = content.current?.closest<HTMLElement>(".task-description-preview");
          (preview ?? content.current)?.focus();
          void loadMarkdown().catch(() => undefined);
        }}>{t("Tentar de novo")}</button>
      </div> : <span className="sr-only" role="status">{t("Carregando descrição…")}</span>}
    </>}
  </div>;
}

/** O resumo aparece dentro do botão da tarefa e não pode conter outros controles. */
export function TaskDescriptionExcerpt({ children }: { children: string }) {
  const state = useMarkdown(Boolean(children));
  if (!children) return null;
  if (state.renderer) return <state.renderer.TaskDescriptionExcerpt>{children}</state.renderer.TaskDescriptionExcerpt>;
  return <span className="t-desc" aria-busy={state.status !== "error"}>{children}</span>;
}

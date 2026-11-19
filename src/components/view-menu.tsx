"use client";
import { useState } from "react";
import type { Layout, ProjectPage, SortMode } from "@/client/types";
import { IconBoard, IconCalendar, IconChevronDown, IconHelp, IconList, IconTable } from "./icons";
import { Dialog, Popover, useIsMobile } from "./ui";

export const SORT_LABEL: Record<SortMode, string> = { manual: "Manual", date: "Data planejada", priority: "Prioridade" };
export const LAYOUT_LABEL: Record<Layout, string> = { list: "Lista", board: "Painel" };

export function ViewMenu({ page, onChange }: {
  page: ProjectPage;
  onChange: (patch: Partial<{ layout: Layout; sortMode: SortMode; showCompleted: boolean }>) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const { view, isInbox } = { view: page.project.view, isInbox: page.project.isInbox };
  const close = () => setOpen(false);

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: mobile ? "8px 16px 24px" : "16px 18px 14px" }}>
      {!mobile && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Visualização</h2>
          <span className="icon-btn" style={{ width: 30, height: 30 }} title="Lista e Painel mostram as mesmas tarefas e seções. Calendário e Tabela chegam depois.">
            <IconHelp />
          </span>
        </div>
      )}
      <div className="lbl" style={{ color: "var(--muted)", fontSize: 12 }}>Layout</div>
      <div className="seg" role="radiogroup" aria-label="Layout do projeto">
        <button type="button" className={`seg-o${view.layout === "list" ? " on" : ""}`} role="radio" aria-checked={view.layout === "list"}
          onClick={() => view.layout !== "list" && onChange({ layout: "list" })}><IconList />Lista</button>
        <button type="button" className={`seg-o${view.layout === "board" ? " on" : ""}`} role="radio" aria-checked={view.layout === "board"}
          disabled={isInbox} title={isInbox ? "A Caixa de entrada não tem seções para virar colunas." : undefined}
          onClick={() => view.layout !== "board" && onChange({ layout: "board" })}><IconBoard />Painel</button>
        <button type="button" className="seg-o" role="radio" aria-checked={false} disabled><span className="badge">Depois</span><IconCalendar />Calendário</button>
        <button type="button" className="seg-o" role="radio" aria-checked={false} disabled><span className="badge">Depois</span><IconTable />Tabela</button>
      </div>
      <div className="row">
        <span id="show-completed-label">Mostrar concluídas</span>
        <button type="button" className={`switch${view.showCompleted ? " on" : ""}`} role="switch" aria-checked={view.showCompleted}
          aria-labelledby="show-completed-label" onClick={() => onChange({ showCompleted: !view.showCompleted })} />
      </div>
      <div className="msep" style={{ margin: mobile ? "0 -16px" : "0 -18px" }} />
      <div className="grp-h">Ordenar</div>
      <div className="row">
        <span>Agrupar</span>
        <span className="select" aria-disabled="true" style={{ color: "var(--muted)" }}>{isInbox ? "Nenhum" : "Seções do projeto"}</span>
      </div>
      <div className="row">
        <label htmlFor="sort-select">Ordenar</label>
        <span style={{ position: "relative" }}>
          <select id="sort-select" className="select" style={{ appearance: "none", paddingRight: 32 }} value={view.sortMode}
            onChange={(event) => onChange({ sortMode: event.target.value as SortMode })}>
            {(Object.keys(SORT_LABEL) as SortMode[]).map((mode) => <option key={mode} value={mode}>{SORT_LABEL[mode]}</option>)}
          </select>
          <IconChevronDown style={{ position: "absolute", right: 10, top: 10, width: 16, height: 16, color: "var(--muted)", pointerEvents: "none" }} />
        </span>
      </div>
      <div className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Filtros por data, prioridade e etiqueta ficam na busca <span className="kbd">/</span>
      </div>
    </div>
  );

  return (
    <>
      <button ref={setAnchor} type="button" className={`icon-btn tool-btn${open ? " on" : ""}`}
        aria-label={`Mostrar: ${LAYOUT_LABEL[view.layout]}`} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        {view.layout === "board" ? <IconBoard /> : <IconList />}
        <span className="tool-label">Mostrar</span>
      </button>
      {mobile
        ? <Dialog open={open} onClose={close} title="Visualização">{body}</Dialog>
        : <Popover anchor={anchor} open={open} onClose={close} label="Visualização" align="end" width={380}>{body}</Popover>}
    </>
  );
}

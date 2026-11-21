"use client";

import { useT } from "./language";

import { useRef, useState } from "react";
import type { Layout, ProjectPage, SortMode } from "@feito/core/types";
import { IconBoard, IconCalendar, IconCheck, IconChevronDown, IconHelp, IconList, IconTable } from "./icons";
import { Dialog, Popover, useIsMobile } from "./ui";

export const SORT_LABEL: Record<SortMode, string> = { manual: "Manual", date: "Data planejada", priority: "Prioridade" };
export const LAYOUT_LABEL: Record<Layout, string> = { list: "Lista", board: "Painel" };
const LAYOUT_HELP = "Lista e Painel mostram as mesmas tarefas e seções. Calendário e Tabela chegam depois.";
const INBOX_LAYOUT_HELP = "A Caixa de entrada não tem seções para virar colunas.";

export function ViewMenu({ page, onChange }: {
  page: ProjectPage;
  onChange: (patch: Partial<{ layout: Layout; sortMode: SortMode; showCompleted: boolean }>) => void;
}) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLButtonElement>(null);
  const mobile = useIsMobile();
  const { view, isInbox } = { view: page.project.view, isInbox: page.project.isInbox };
  const label = t("Mostrar: {0}", [t(LAYOUT_LABEL[view.layout])]);
  const close = () => { setOpen(false); setSortOpen(false); };
  const closeSort = () => setSortOpen(false);

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: mobile ? "8px 16px 24px" : "16px 18px 14px" }}>
      {!mobile && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t("Visualização")}</h2>
          <span className="icon-btn" style={{ width: 30, height: 30 }} role="img" tabIndex={0}
            aria-label={t("Sobre os layouts")} aria-description={t(LAYOUT_HELP)} data-tooltip={t(LAYOUT_HELP)}>
            <IconHelp />
          </span>
        </div>
      )}
      <div className="lbl" style={{ color: "var(--muted)", fontSize: 12 }}>Layout</div>
      <div className="seg" role="radiogroup" aria-label={t("Layout do projeto")}>
        <button type="button" className={`seg-o${view.layout === "list" ? " on" : ""}`} role="radio" aria-checked={view.layout === "list"}
          onClick={() => view.layout !== "list" && onChange({ layout: "list" })}><IconList />{t("Lista")}</button>
        <button type="button" className={`seg-o${view.layout === "board" ? " on" : ""}`} role="radio" aria-checked={view.layout === "board"}
          disabled={isInbox} data-tooltip={isInbox ? t(INBOX_LAYOUT_HELP) : undefined} aria-description={isInbox ? t(INBOX_LAYOUT_HELP) : undefined}
          onClick={() => view.layout !== "board" && onChange({ layout: "board" })}><IconBoard />{t("Painel")}</button>
        <button type="button" className="seg-o" role="radio" aria-checked={false} disabled><span className="badge">{t("Depois")}</span><IconCalendar />{t("Calendário")}</button>
        <button type="button" className="seg-o" role="radio" aria-checked={false} disabled><span className="badge">{t("Depois")}</span><IconTable />{t("Tabela")}</button>
      </div>
      <div className="row">
        <span id="show-completed-label">{t("Mostrar concluídas")}</span>
        <button type="button" className={`switch${view.showCompleted ? " on" : ""}`} role="switch" aria-checked={view.showCompleted}
          aria-labelledby="show-completed-label" onClick={() => onChange({ showCompleted: !view.showCompleted })} />
      </div>
      <div className="msep" style={{ margin: mobile ? "0 -16px" : "0 -18px" }} />
      <div className="grp-h">{t("Ordenar")}</div>
      <div className="row">
        <span>{t("Agrupar")}</span>
        <span className="select" aria-disabled="true" style={{ color: "var(--muted)" }}>{isInbox ? t("Nenhum") : t("Seções do projeto")}</span>
      </div>
      <div className="row">
        <span id="sort-label">{t("Ordenar")}</span>
        <button ref={sortRef} type="button" className="select" aria-haspopup="listbox" aria-expanded={sortOpen}
          aria-labelledby="sort-label sort-value" onClick={() => setSortOpen((value) => !value)}>
          <span id="sort-value">{t(SORT_LABEL[view.sortMode])}</span>
          <IconChevronDown />
        </button>
      </div>
      <Popover anchor={sortRef.current} open={sortOpen} onClose={closeSort} label={t("Ordenar tarefas")} role="listbox" width={200} align="end">
        <div className="ps-list" role="presentation">
          {(Object.keys(SORT_LABEL) as SortMode[]).map((mode) => {
            const selected = view.sortMode === mode;
            return (
              <button key={mode} type="button" role="option" aria-selected={selected}
                className={`mi ps-option${selected ? " on" : ""}`} data-autofocus={selected || undefined}
                onClick={() => { onChange({ sortMode: mode }); closeSort(); }}>
                <span className="ps-check">{selected && <IconCheck />}</span>
                <span>{t(SORT_LABEL[mode])}</span>
              </button>
            );
          })}
        </div>
      </Popover>
      <div className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {t("Filtros por data, prioridade e etiqueta ficam na busca")}{" "}<span className="kbd">/</span>
      </div>
    </div>
  );

  return (
    <>
      <button ref={setAnchor} type="button" className={`icon-btn tool-btn${open ? " on" : ""}`}
        data-tooltip={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => open ? close() : setOpen(true)}>
        {view.layout === "board" ? <IconBoard /> : <IconList />}
        <span className="tool-label">{t("Mostrar")}</span>
      </button>
      {mobile
        ? <Dialog open={open} onClose={close} title={t("Visualização")}>{body}</Dialog>
        : <Popover anchor={anchor} open={open} onClose={close} label={t("Visualização")} align="end" width={380}>{body}</Popover>}
    </>
  );
}

"use client";

import { useT } from "./language";

import { useRef, useState } from "react";
import type { Layout, ProjectView, SortMode } from "@feito/core/types";
import { IconBoard, IconCalendar, IconCheck, IconChevronDown, IconClock, IconHelp, IconList, IconTable } from "./icons";
import { Dialog, Popover, useIsMobile, useIsPhone } from "./ui";

export const SORT_LABEL: Record<SortMode, string> = { manual: "Manual", date: "Data planejada", priority: "Prioridade" };
export const LAYOUT_LABEL: Record<Layout, string> = { list: "Lista", board: "Painel", calendar: "Calendário", table: "Tabela" };
const LAYOUT_HELP = "Lista, Painel e Tabela mostram as mesmas tarefas e seções. O Calendário distribui as tarefas pela data planejada.";
const LAYOUT_ICON: Record<Layout, typeof IconList> = { list: IconList, board: IconBoard, calendar: IconCalendar, table: IconTable };
const INBOX_LAYOUT_HELP = "A Entrada não tem seções para virar colunas.";

/** Onde o menu aparece: um projeto, a Entrada ou uma agenda (Hoje e Em breve, agrupadas por dia e só com o layout). */
export type ViewScope = "project" | "inbox" | "agenda";

export function ViewMenu({ view, scope, onChange, timeline, hideCalendar = false }: {
  view: ProjectView;
  scope: ViewScope;
  onChange: (patch: Partial<{ layout: Layout; sortMode: SortMode; showCompleted: boolean }>) => void;
  /** Hoje: a Agenda aparece como primeira opção de layout. */
  timeline?: { on: boolean; onPick: () => void };
  hideCalendar?: boolean;
}) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLButtonElement>(null);
  const mobile = useIsMobile();
  const phone = useIsPhone();
  const isInbox = scope === "inbox";
  const agenda = scope === "agenda";
  // No celular não há Tabela: uma visão salva assim aparece como Lista, sem alterar o que está gravado.
  const layout: Layout = phone && view.layout === "table" ? "list" : view.layout;
  const timelineOn = !!timeline?.on;
  const layoutCount = (phone ? 3 : 4) - Number(hideCalendar) + Number(!!timeline);
  const label = t("Mostrar: {0}", [timelineOn ? t("Agenda") : t(LAYOUT_LABEL[layout])]);
  const LayoutIcon = timelineOn ? IconClock : LAYOUT_ICON[layout];
  const on = (value: Layout) => !timelineOn && layout === value;
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
      <div className="lbl" style={{ color: "var(--text-2)", fontSize: 12 }}>Layout</div>
      <div className="seg" role="radiogroup" aria-label={agenda ? t("Layout") : t("Layout do projeto")}
        style={{ gridTemplateColumns: `repeat(${layoutCount},minmax(0,1fr))` }}>
        {timeline && <button type="button" className={`seg-o${timelineOn ? " on" : ""}`} role="radio" aria-checked={timelineOn}
          onClick={() => !timelineOn && timeline.onPick()}><IconClock />{t("Agenda")}</button>}
        <button type="button" className={`seg-o${on("list") ? " on" : ""}`} role="radio" aria-checked={on("list")}
          onClick={() => !on("list") && onChange({ layout: "list" })}><IconList />{t("Lista")}</button>
        <button type="button" className={`seg-o${on("board") ? " on" : ""}`} role="radio" aria-checked={on("board")}
          disabled={isInbox} data-tooltip={isInbox ? t(INBOX_LAYOUT_HELP) : undefined} aria-description={isInbox ? t(INBOX_LAYOUT_HELP) : undefined}
          onClick={() => !on("board") && onChange({ layout: "board" })}><IconBoard />{t("Painel")}</button>
        {!hideCalendar && <button type="button" className={`seg-o${on("calendar") ? " on" : ""}`} role="radio" aria-checked={on("calendar")}
          onClick={() => !on("calendar") && onChange({ layout: "calendar" })}><IconCalendar />{t("Calendário")}</button>
        }
        {!phone && <button type="button" className={`seg-o${on("table") ? " on" : ""}`} role="radio" aria-checked={on("table")}
          onClick={() => !on("table") && onChange({ layout: "table" })}><IconTable />{t("Tabela")}</button>}
      </div>
      {!agenda && <div className="row">
        <span id="show-completed-label">{t("Mostrar concluídas")}</span>
        <button type="button" className={`switch${view.showCompleted ? " on" : ""}`} role="switch" aria-checked={view.showCompleted}
          aria-labelledby="show-completed-label" onClick={() => onChange({ showCompleted: !view.showCompleted })} />
      </div>}
      <div className="msep" style={{ margin: mobile ? "0 -16px" : "0 -18px" }} />
      {!agenda && <div className="grp-h">{t("Ordenar")}</div>}
      <div className="row">
        <span>{t("Agrupar")}</span>
        <span className="select" aria-disabled="true" style={{ color: "var(--text-2)" }}>{layout === "calendar" || agenda ? t("Por dia") : isInbox ? t("Nenhum") : t("Seções do projeto")}</span>
      </div>
      {!agenda && <div className="row">
        <span id="sort-label">{t("Ordenar")}</span>
        <button ref={sortRef} type="button" className="select" aria-haspopup="listbox" aria-expanded={sortOpen}
          aria-labelledby="sort-label sort-value" onClick={() => setSortOpen((value) => !value)}>
          <span id="sort-value">{t(SORT_LABEL[view.sortMode])}</span>
          <IconChevronDown />
        </button>
      </div>}
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
        <LayoutIcon />
        <span className="tool-label">{t("Mostrar")}</span>
      </button>
      {mobile
        ? <Dialog open={open} onClose={close} title={t("Visualização")}>{body}</Dialog>
        : <Popover anchor={anchor} open={open} onClose={close} label={t("Visualização")} align="end" width={380}>{body}</Popover>}
    </>
  );
}

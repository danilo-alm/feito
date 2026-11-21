"use client";

import { useT } from "../components/language";
import { inSentence } from "../client/locale";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../client/api";
import { tagColor } from "../client/colors";
import { dateLabel } from "../client/dates";
import { useQuery } from "../client/store";
import { useTaskPagination } from "../client/task-pagination";
import type { Priority, SearchDate, SearchInput, SearchResult } from "@feito/core/types";
import { useApp } from "../components/app";
import { PageHeader } from "../components/chrome";
import { FlatGroup } from "../components/flat-list";
import { IconCalendar, IconChevronDown, IconChevronLeft, IconFlag, IconInbox, IconSearch, IconTag, IconX } from "../components/icons";
import { ProjectGlyph } from "../components/project-style";
import { DatePicker, PriorityMenu } from "../components/pickers";
import { useTaskActions } from "../components/task-actions";
import { Popover, ReadFallback } from "../components/ui";

type Filter = "project" | "label" | "priority" | "date" | null;
type RangeEndpoint = "from" | "to";

const DATE_NAMES = { today: "Hoje", overdue: "Atrasadas", none: "Sem data" } as const;

export default function SearchPage() {
  const t = useT();
  const app = useApp();
  const actions = useTaskActions();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>();
  const [labelId, setLabelId] = useState<string | undefined>();
  const [priority, setPriority] = useState<Priority | undefined>();
  const [date, setDate] = useState<SearchDate | undefined>();
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [open, setOpen] = useState<Filter>(null);
  const [rangeEndpoint, setRangeEndpoint] = useState<RangeEndpoint | null>(null);
  const [range, setRange] = useState({ from: app.reference, to: app.reference });
  const anchors = useRef<Record<string, HTMLButtonElement | null>>({});
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(text), 250);
    return () => window.clearTimeout(timer);
  }, [text]);
  useEffect(() => input.current?.focus(), []);

  const criteria: SearchInput = useMemo(() => ({
    text: debounced.trim() || undefined, projectId, labelId, priority, date, includeCompleted,
  }), [debounced, projectId, labelId, priority, date, includeCompleted]);
  const hasCriteria = !!(criteria.text || projectId || labelId || priority || date);
  const key = hasCriteria ? `search:${JSON.stringify(criteria)}` : null;
  const query = useQuery<SearchResult>(key, () => api.search(criteria));
  const pagination = useTaskPagination(key, query.data, "results", async (cursor) => {
    const page = await api.search({ ...criteria, cursor });
    return { tasks: page.results, nextCursor: page.nextCursor };
  });
  const { tasks: results, cursor } = pagination;
  const active = results.filter((task) => task.status === "active");
  const done = results.filter((task) => task.status === "completed");

  const inboxId = app.nav?.inbox.projectId ?? app.me.inboxProjectId;
  const projectName = projectId === inboxId ? t("Caixa de entrada") : app.nav?.projects.find((item) => item.id === projectId)?.name;
  const labelName = app.nav?.labels.find((item) => item.id === labelId)?.name;
  const dateName = date ? (date.kind === "range" ? `${dateLabel(date.from, app.reference)} – ${dateLabel(date.to, app.reference)}` : t(DATE_NAMES[date.kind])) : null;
  const clear = () => { setProjectId(undefined); setLabelId(undefined); setPriority(undefined); setDate(undefined); };
  const close = () => { setOpen(null); setRangeEndpoint(null); };

  const pill = (key: Exclude<Filter, null>, icon: React.ReactNode, label: string, value: string | null | undefined, reset: () => void) => (
    <span style={{ display: "inline-flex" }}>
      <button type="button" ref={(node) => { anchors.current[key] = node; }} className={`pill${value ? " on" : ""}`}
        aria-haspopup="dialog" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
        {icon}{value ?? label}{!value && <IconChevronDown className="sm" />}
      </button>
      {value && (
        <button type="button" className="icon-btn" style={{ width: 28, height: 30, minHeight: 0 }} aria-label={t("Remover filtro de {0}", [inSentence(label)])} onClick={reset}>
          <IconX className="sm" />
        </button>
      )}
    </span>
  );

  return (
    <>
      <PageHeader crumb={t("Busca")} mobileTitle={t("Buscar")} back="/navegar"
        tools={<span className="hint" style={{ display: "flex", gap: 6, alignItems: "center" }}><span className="kbd">Esc</span>{t("limpa o texto")}</span>} />
      <div className="content">
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 className="sr-only">{t("Buscar tarefas")}</h1>
          <div style={{ position: "relative", marginTop: 8 }}>
            <label htmlFor="q" className="sr-only">{t("Buscar tarefas por título ou descrição")}</label>
            <IconSearch style={{ position: "absolute", left: 14, top: 14, color: "var(--muted)" }} />
            <input id="q" ref={input} className="input" type="search" placeholder={t("Buscar por título ou descrição")} value={text}
              style={{ paddingLeft: 42, fontSize: 16, height: 46 }} autoComplete="off"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setText(""); }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {pill("project", projectId === inboxId ? <IconInbox /> : <ProjectGlyph id={projectId} />, t("Projeto"), projectName, () => setProjectId(undefined))}
            {pill("label", <IconTag style={{ color: tagColor(labelId) }} />, t("Etiqueta"), labelName, () => setLabelId(undefined))}
            {pill("priority", <IconFlag />, t("Prioridade"), priority ? `P${priority}` : null, () => setPriority(undefined))}
            {pill("date", <IconCalendar />, t("Data"), dateName, () => setDate(undefined))}
            {(projectId || labelId || priority || date) && <button type="button" className="btn ghost" style={{ height: 30, color: "var(--muted)" }} onClick={clear}>{t("Limpar filtros")}</button>}
            <span style={{ flex: 1 }} />
            <span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
              <span id="inc-done">{t("Incluir concluídas")}</span>
              <button type="button" className={`switch${includeCompleted ? " on" : ""}`} role="switch" aria-checked={includeCompleted}
                aria-labelledby="inc-done" onClick={() => setIncludeCompleted((value) => !value)} />
            </span>
          </div>
          <div role="status" aria-live="polite" className="sub">
            {!hasCriteria ? t("Digite um trecho ou escolha um filtro. Acentos e maiúsculas não fazem diferença.")
              : query.data ? `${results.length}${cursor ? "+" : ""} ${results.length === 1 ? "resultado" : "resultados"}${criteria.text ? t(" para “{0}”", [criteria.text]) : ""}${projectName ? t(" em {0}", [projectName]) : ""}`
                : query.error ? "" : t("Buscando…")}
          </div>
          {hasCriteria && !query.data && <ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} />}
          {query.data && (
            <div>
              <FlatGroup title={t("Ativas")} count={active.length} tasks={active} actions={actions}
                empty={<p className="hint" style={{ padding: "10px 4px" }}>{t("Nenhuma tarefa ativa encontrada.")}</p>} />
              {includeCompleted && <FlatGroup title={t("Concluídas")} count={done.length} tasks={done} actions={actions} muted />}
              {pagination.error && <p className="hint" role="alert">{pagination.error}</p>}
              {cursor && <button type="button" className="btn" style={{ marginTop: 12 }} disabled={pagination.loading}
                onClick={() => void pagination.loadMore()}>{t("Carregar mais")}</button>}
            </div>
          )}
        </div>
      </div>

      <Popover anchor={anchors.current.project ?? null} open={open === "project"} onClose={close} label={t("Projeto")}>
        <div className="menu" style={{ maxHeight: 320, overflow: "auto" }}>
          <button type="button" className="mi" onClick={() => { setProjectId(inboxId); close(); }}><IconInbox />{t("Caixa de entrada")}</button>
          {app.nav?.projects.map((project) => (
            <button key={project.id} type="button" className="mi" onClick={() => { setProjectId(project.id); close(); }}><ProjectGlyph id={project.id} />{project.name}</button>
          ))}
        </div>
      </Popover>
      <Popover anchor={anchors.current.label ?? null} open={open === "label"} onClose={close} label={t("Etiqueta")}>
        <div className="menu" style={{ maxHeight: 320, overflow: "auto" }}>
          {!app.nav?.labels.length && <p className="hint" style={{ padding: 8 }}>{t("Nenhuma etiqueta criada.")}</p>}
          {app.nav?.labels.map((label) => (
            <button key={label.id} type="button" className="mi" onClick={() => { setLabelId(label.id); close(); }}><IconTag style={{ color: tagColor(label.id) }} />{label.name}</button>
          ))}
        </div>
      </Popover>
      <Popover anchor={anchors.current.priority ?? null} open={open === "priority"} onClose={close} label={t("Prioridade")}>
        <PriorityMenu value={priority ?? 4} onPick={(value) => { setPriority(value); close(); }} />
      </Popover>
      <Popover anchor={anchors.current.date ?? null} open={open === "date"} onClose={close} label={t("Data")} width={280}>
        {rangeEndpoint ? (
          <div className="range-date-panel">
            <button type="button" className="text-btn" onClick={() => setRangeEndpoint(null)}><IconChevronLeft />{t("Voltar ao intervalo")}</button>
            <span className="lbl">{rangeEndpoint === "from" ? t("Data inicial") : t("Data final")}</span>
            <DatePicker value={range[rangeEndpoint]} reference={app.reference} allowClear={false} autoFocus
              onPick={(value) => { if (value) setRange((current) => ({ ...current, [rangeEndpoint]: value })); }}
              onClose={() => setRangeEndpoint(null)} />
          </div>
        ) : (
          <div className="date-pop">
            {(Object.keys(DATE_NAMES) as (keyof typeof DATE_NAMES)[]).map((kind) => (
              <button key={kind} type="button" className="mi" onClick={() => { setDate({ kind }); close(); }}>{t(DATE_NAMES[kind])}</button>
            ))}
            <form onSubmit={(event) => { event.preventDefault(); if (range.from <= range.to) { setDate({ kind: "range", ...range }); close(); } }}
              style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid var(--border)", marginTop: 4 }}>
              <span className="lbl">{t("Intervalo")}</span>
              <span className="range-date-field">
                <span>{t("De")}</span>
                <button type="button" className="select" aria-label={t("Data inicial: {0}", [dateLabel(range.from, app.reference)])}
                  onClick={() => setRangeEndpoint("from")}>{dateLabel(range.from, app.reference)}<IconChevronDown /></button>
              </span>
              <span className="range-date-field">
                <span>{t("Até")}</span>
                <button type="button" className="select" aria-label={t("Data final: {0}", [dateLabel(range.to, app.reference)])}
                  onClick={() => setRangeEndpoint("to")}>{dateLabel(range.to, app.reference)}<IconChevronDown /></button>
              </span>
              <button type="submit" className="btn" disabled={!range.from || !range.to || range.from > range.to}>{t("Aplicar intervalo")}</button>
            </form>
          </div>
        )}
      </Popover>
      {actions.moveDialog}
    </>
  );
}

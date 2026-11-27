"use client";
import { useT } from "../components/language";

import { useState } from "react";
import { api } from "../client/api";
import { addDays, dateLabel, dayParts, rangeLabel, shortDate } from "../client/dates";
import { useQuery } from "../client/store";
import type { UpcomingView } from "@feito/core/types";
import { useApp } from "../components/app";
import { PageHeader, PageTaskCount } from "../components/chrome";
import { FlatGroup } from "../components/flat-list";
import { CreateSlot, useStartCreate } from "../components/task-editor";
import { IconChevronLeft, IconChevronRight, IconPlus } from "../components/icons";
import { useTaskActions } from "../components/task-actions";
import { ReadFallback, useIsMobile, useIsPhone } from "../components/ui";
import { AgendaLayout, AgendaViewMenu, isWideAgenda, useAgendaLayout } from "../components/agenda-view";

export default function UpcomingPage() {
  const t = useT();
  const app = useApp();
  const actions = useTaskActions();
  const startCreate = useStartCreate();
  const tomorrow = addDays(app.reference, 1);
  const [start, setStart] = useState<string | null>(null);
  const first = start && start >= tomorrow ? start : tomorrow;
  const query = useQuery<UpcomingView>(`upcoming:${first}`, () => api.views.upcoming(first));
  const data = query.data?.start === first ? query.data : undefined;
  const last = addDays(first, 6);
  const mobile = useIsMobile();
  const [layout, setLayout] = useAgendaLayout("upcomingLayout");
  const phone = useIsPhone();
  const wide = isWideAgenda(layout, phone);
  const viewMenu = <AgendaViewMenu layout={layout} onChange={setLayout} />;
  const dayTitle = (date: string) =>
    dateLabel(date, app.reference) === t("Amanhã") ? t("Amanhã · {0}", [shortDate(date)]) : shortDate(date);
  const nav = (
    <>
      <button type="button" className="icon-btn" aria-label={t("Semana anterior")} disabled={first <= tomorrow}
        onClick={() => setStart(addDays(first, -7))}><IconChevronLeft /></button>
      <span style={{ fontSize: 13, fontWeight: 600, padding: "0 6px", whiteSpace: "nowrap" }}>{rangeLabel(first, last)}</span>
      <button type="button" className="icon-btn" aria-label={t("Próxima semana")} onClick={() => setStart(addDays(first, 7))}><IconChevronRight /></button>
    </>
  );
  return (
    <>
      <PageHeader crumb={t("Próximos sete dias")} title={t("Em breve")} tools={<>{nav}{viewMenu}</>} />
      <div className={wide ? "project-content" : "content"}>
        <div className={wide ? "project-head" : "col"} style={wide ? { padding: "4px 32px 0" } : undefined}>
          <div className="page-h"><h1 className="title">{t("Em breve")}</h1>{data && <PageTaskCount count={data.days.reduce((sum, day) => sum + day.tasks.length, 0)} />}</div>
          {!wide && <div className="week" role="list" aria-label={t("Dias da semana")}>
            {Array.from({ length: 7 }, (_, index) => addDays(first, index)).map((date) => {
              const { weekday, day } = dayParts(date);
              const count = data?.days.find((item) => item.date === date)?.tasks.length ?? 0;
              return (
                <a key={date} role="listitem" href={`#dia-${date}`} className={`day-btn${date === first ? " on" : ""}`}
                  aria-label={`${shortDate(date)}, ${count} ${count === 1 ? t("tarefa") : t("tarefas")}`}>
                  <span className="w">{weekday}</span><span className="n">{day}</span>
                </a>
              );
            })}
          </div>}
          {!data ? <ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} /> : !wide && data.days.map((day) => {
            const title = dayTitle(day.date);
            return (
              <div key={day.date} id={`dia-${day.date}`} style={{ scrollMarginTop: 80 }}>
                <FlatGroup title={title} count={day.tasks.length || undefined} tasks={day.tasks} actions={actions} timeOnly
                  aside={(
                    <button type="button" className="icon-btn" style={{ marginLeft: "auto", width: 28, height: 28, minHeight: 0 }}
                      aria-label={t("Adicionar tarefa em {0}", [shortDate(day.date)])} onClick={() => startCreate(`add:day:${day.date}`, { dueDate: day.date })}>
                      <IconPlus className="sm" />
                    </button>
                  )}
                  empty={<div className="sub" style={{ padding: "12px 4px", borderBottom: "1px solid var(--border)" }}>{t("Nada planejado.")}</div>} />
                <CreateSlot slot={`add:day:${day.date}`} defaults={{ dueDate: day.date }} />
              </div>
            );
          })}
        </div>
        {data && wide && <AgendaLayout layout={layout} mobile={mobile} actions={actions} dates={data.days.map((day) => day.date)}
          groups={data.days.map((day) => ({ key: day.date, title: dayTitle(day.date), date: day.date, tasks: day.tasks }))} />}
      </div>
      {actions.moveDialog}
    </>
  );
}

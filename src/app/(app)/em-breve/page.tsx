"use client";
import { useState } from "react";
import { api } from "@/client/api";
import { addDays, dateLabel, dayParts, monthTitle, rangeLabel, shortDate } from "@/client/dates";
import { useQuery } from "@/client/store";
import type { UpcomingView } from "@/client/types";
import { useApp } from "@/components/app";
import { PageHeader } from "@/components/chrome";
import { FlatGroup } from "@/components/flat-list";
import { IconChevronLeft, IconChevronRight, IconPlus } from "@/components/icons";
import { useTaskActions } from "@/components/task-actions";
import { Spinner } from "@/components/ui";

export default function UpcomingPage() {
  const app = useApp();
  const actions = useTaskActions();
  const tomorrow = addDays(app.reference, 1);
  const [start, setStart] = useState<string | null>(null);
  const first = start && start >= tomorrow ? start : tomorrow;
  const query = useQuery<UpcomingView>(`upcoming:${first}`, () => api.views.upcoming(first));
  const data = query.data?.start === first ? query.data : undefined;
  const last = addDays(first, 6);
  const nav = (
    <>
      <button type="button" className="icon-btn" aria-label="Semana anterior" disabled={first <= tomorrow}
        onClick={() => setStart(addDays(first, -7))}><IconChevronLeft /></button>
      <span style={{ fontSize: 13, fontWeight: 600, padding: "0 6px", whiteSpace: "nowrap" }}>{rangeLabel(first, last)}</span>
      <button type="button" className="icon-btn" aria-label="Próxima semana" onClick={() => setStart(addDays(first, 7))}><IconChevronRight /></button>
    </>
  );
  return (
    <>
      <PageHeader crumb="Próximos sete dias" tools={nav} />
      <div className="content">
        <div className="col">
          <div className="page-h"><h1 className="title">Em breve</h1><span className="sub">{monthTitle(first)}</span></div>
          <div className="week" role="list" aria-label="Dias da semana">
            {Array.from({ length: 7 }, (_, index) => addDays(first, index)).map((date) => {
              const { weekday, day } = dayParts(date);
              const count = data?.days.find((item) => item.date === date)?.tasks.length ?? 0;
              return (
                <a key={date} role="listitem" href={`#dia-${date}`} className={`day-btn${date === first ? " on" : ""}`}
                  aria-label={`${shortDate(date)}, ${count} ${count === 1 ? "tarefa" : "tarefas"}`}>
                  <span className="w">{weekday}</span><span className="n">{day}</span>
                </a>
              );
            })}
          </div>
          {!data ? <Spinner /> : data.days.map((day) => {
            const relative = dateLabel(day.date, app.reference);
            const title = relative === "Amanhã" ? `Amanhã · ${shortDate(day.date)}` : shortDate(day.date);
            return (
              <div key={day.date} id={`dia-${day.date}`} style={{ scrollMarginTop: 80 }}>
                <FlatGroup title={title} count={day.tasks.length || undefined} tasks={day.tasks} actions={actions} timeOnly
                  aside={(
                    <button type="button" className="icon-btn" style={{ marginLeft: "auto", width: 28, height: 28, minHeight: 0 }}
                      aria-label={`Adicionar tarefa em ${shortDate(day.date)}`} onClick={() => app.openQuickAdd({ dueDate: day.date })}>
                      <IconPlus className="sm" />
                    </button>
                  )}
                  empty={<div className="sub" style={{ padding: "12px 4px", borderBottom: "1px solid var(--border)" }}>Nada planejado.</div>} />
              </div>
            );
          })}
        </div>
      </div>
      {actions.moveDialog}
    </>
  );
}

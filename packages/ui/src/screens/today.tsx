"use client";
import { useT } from "../components/language";

import { useState } from "react";
import { api } from "../client/api";
import { shortDate } from "../client/dates";
import { useQuery } from "../client/store";
import type { TodayView } from "@feito/core/types";
import { PageHeader, PageTaskCount } from "../components/chrome";
import { FlatGroup } from "../components/flat-list";
import { IconCheck, IconPlus, IconToday } from "../components/icons";
import { useTaskActions } from "../components/task-actions";
import { AddTaskSlot } from "../components/task-editor";
import { ReadFallback, useIsMobile, useIsPhone } from "../components/ui";
import { AgendaLayout, AgendaViewMenu, isWideAgenda, useAgendaLayout, type AgendaGroup } from "../components/agenda-view";

export default function TodayPage() {
  const t = useT();
  const actions = useTaskActions();
  const [showDone, setShowDone] = useState(false);
  const query = useQuery<TodayView>(`today:${showDone}`, () => api.views.today(showDone));
  const data = query.data;
  const total = data ? data.overdue.length + data.today.length : 0;
  const mobile = useIsMobile();
  const [layout, setLayout] = useAgendaLayout("todayLayout");
  const phone = useIsPhone();
  const wide = isWideAgenda(layout, phone);
  const viewMenu = <AgendaViewMenu layout={layout} onChange={setLayout} />;
  const toggle = (
    <button type="button" className={`btn ghost${showDone ? " on" : ""}`} aria-pressed={showDone}
      style={{ color: showDone ? "var(--accent-text)" : "var(--text-2)" }} onClick={() => setShowDone((value) => !value)}>
      <IconCheck />{t("Concluídas")}</button>
  );
  return (
    <>
      <PageHeader crumb={t("Agenda do dia")} title={t("Hoje")} tools={<>{toggle}{viewMenu}</>}
        mobileTools={<>
          <button type="button" className="icon-btn" aria-pressed={showDone} aria-label={t("Mostrar concluídas de hoje")}
            onClick={() => setShowDone((value) => !value)} style={showDone ? { color: "var(--accent-text)" } : undefined}><IconCheck /></button>
          {viewMenu}
        </>} />
      <div className={wide ? "project-content" : "content"}>
        <div className={wide ? "project-head" : "col"} style={wide ? { padding: "4px 32px 0" } : undefined}>
          <div className="page-h">
            <h1 className="title nav-title"><IconToday />{t("Hoje")}</h1>
            {data && <PageTaskCount count={total} />}
          </div>
          {!data && <ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} />}
          {data && !wide && (
            <>
              {data.overdue.length > 0 && <FlatGroup title={t("Atrasadas")} late count={data.overdue.length} tasks={data.overdue} actions={actions} />}
              <FlatGroup title={t("Hoje · {0}", [shortDate(data.referenceDate)])} count={data.today.length} tasks={data.today} actions={actions} timeOnly
                empty={!data.overdue.length ? (
                  <div className="empty"><strong>{t("Tudo em dia")}</strong>{t("Nada planejado para hoje.")}</div>
                ) : undefined} />
              <AddTaskSlot slot="add:today" defaults={{ dueDate: data.referenceDate }}>
                {(start) => (
                  <button type="button" className="add-task" data-flip="add:today" onClick={start}>
                    <span className="plus"><IconPlus /></span>{t("Adicionar tarefa para hoje")}</button>
                )}
              </AddTaskSlot>
              {showDone && (
                <FlatGroup title={t("Concluídas hoje")} count={data.completedToday?.length ?? 0} tasks={data.completedToday ?? []}
                  actions={actions} muted empty={<p className="hint" style={{ padding: "10px 4px" }}>{t("Nenhuma tarefa concluída hoje.")}</p>} />
              )}
            </>
          )}
        </div>
        {data && wide && <AgendaLayout layout={layout} mobile={mobile} actions={actions} dates={[data.referenceDate]}
          groups={[
            ...data.overdue.length ? [{ key: "overdue", title: t("Atrasadas"), tasks: data.overdue, late: true }] : [],
            { key: data.referenceDate, title: t("Hoje · {0}", [shortDate(data.referenceDate)]), date: data.referenceDate,
              tasks: [...data.today, ...showDone ? data.completedToday ?? [] : []] },
          ] satisfies AgendaGroup[]} />}
      </div>
      {actions.moveDialog}
    </>
  );
}

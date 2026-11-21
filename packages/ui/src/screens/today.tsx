"use client";
import { useT } from "../components/language";

import { useState } from "react";
import { api } from "../client/api";
import { shortDate } from "../client/dates";
import { useQuery } from "../client/store";
import type { TodayView } from "@feito/core/types";
import { PageHeader, PageTaskCount } from "../components/chrome";
import { FlatGroup } from "../components/flat-list";
import { IconCheck, IconPlus } from "../components/icons";
import { useTaskActions } from "../components/task-actions";
import { AddTaskSlot } from "../components/task-editor";
import { ReadFallback } from "../components/ui";

export default function TodayPage() {
  const t = useT();
  const actions = useTaskActions();
  const [showDone, setShowDone] = useState(false);
  const query = useQuery<TodayView>(`today:${showDone}`, () => api.views.today(showDone));
  const data = query.data;
  const total = data ? data.overdue.length + data.today.length : 0;
  const toggle = (
    <button type="button" className={`btn ghost${showDone ? " on" : ""}`} aria-pressed={showDone}
      style={{ color: showDone ? "var(--brand-text)" : "var(--muted)" }} onClick={() => setShowDone((value) => !value)}>
      <IconCheck />{t("Concluídas")}</button>
  );
  return (
    <>
      <PageHeader crumb={t("Agenda do dia")} title={t("Hoje")} tools={toggle}
        mobileTools={<button type="button" className="icon-btn" aria-pressed={showDone} aria-label={t("Mostrar concluídas de hoje")}
          onClick={() => setShowDone((value) => !value)} style={showDone ? { color: "var(--brand-text)" } : undefined}><IconCheck /></button>} />
      <div className="content">
        <div className="col">
          <div className="page-h">
            <h1 className="title">{t("Hoje")}</h1>
            {data && <PageTaskCount count={total} />}
          </div>
          {!data ? <ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} /> : (
            <>
              {data.overdue.length > 0 && <FlatGroup title={t("Atrasadas")} count={data.overdue.length} tasks={data.overdue} actions={actions} />}
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
      </div>
      {actions.moveDialog}
    </>
  );
}

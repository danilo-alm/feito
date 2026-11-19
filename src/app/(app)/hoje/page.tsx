"use client";
import { useState } from "react";
import { api } from "@/client/api";
import { shortDate } from "@/client/dates";
import { useQuery } from "@/client/store";
import type { TodayView } from "@/client/types";
import { PageHeader, PageTaskCount } from "@/components/chrome";
import { FlatGroup } from "@/components/flat-list";
import { IconCheck, IconPlus } from "@/components/icons";
import { useTaskActions } from "@/components/task-actions";
import { AddTaskSlot } from "@/components/task-editor";
import { Spinner } from "@/components/ui";

export default function TodayPage() {
  const actions = useTaskActions();
  const [showDone, setShowDone] = useState(false);
  const query = useQuery<TodayView>(`today:${showDone}`, () => api.views.today(showDone));
  const data = query.data;
  const total = data ? data.overdue.length + data.today.length : 0;
  const toggle = (
    <button type="button" className={`btn ghost${showDone ? " on" : ""}`} aria-pressed={showDone}
      style={{ color: showDone ? "var(--brand-text)" : "var(--muted)" }} onClick={() => setShowDone((value) => !value)}>
      <IconCheck />Concluídas
    </button>
  );
  return (
    <>
      <PageHeader crumb="Agenda do dia" tools={toggle}
        mobileTools={<button type="button" className="icon-btn" aria-pressed={showDone} aria-label="Mostrar concluídas de hoje"
          onClick={() => setShowDone((value) => !value)} style={showDone ? { color: "var(--brand-text)" } : undefined}><IconCheck /></button>} />
      <div className="content">
        <div className="col">
          <div className="page-h">
            <h1 className="title">Hoje</h1>
            {data && <PageTaskCount count={total} />}
          </div>
          {!data ? <Spinner /> : (
            <>
              {data.overdue.length > 0 && <FlatGroup title="Atrasadas" count={data.overdue.length} tasks={data.overdue} actions={actions} />}
              <FlatGroup title={`Hoje · ${shortDate(data.referenceDate)}`} count={data.today.length} tasks={data.today} actions={actions} timeOnly
                empty={!data.overdue.length ? (
                  <div className="empty"><strong>Tudo em dia</strong>Nada planejado para hoje.</div>
                ) : undefined} />
              <AddTaskSlot slot="add:today" defaults={{ dueDate: data.referenceDate }}>
                {(start) => (
                  <button type="button" className="add-task" data-flip="add:today" onClick={start}>
                    <span className="plus"><IconPlus /></span>Adicionar tarefa para hoje
                  </button>
                )}
              </AddTaskSlot>
              {showDone && (
                <FlatGroup title="Concluídas hoje" count={data.completedToday?.length ?? 0} tasks={data.completedToday ?? []}
                  actions={actions} muted empty={<p className="hint" style={{ padding: "10px 4px" }}>Nenhuma tarefa concluída hoje.</p>} />
              )}
            </>
          )}
        </div>
      </div>
      {actions.moveDialog}
    </>
  );
}

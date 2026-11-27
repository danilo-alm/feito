"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { TaskItem } from "@feito/core/types";
import { projectStyle } from "../client/colors";
import { FREQUENCY_LABEL } from "../client/dates";
import { useApp } from "./app";
import { FlatGroup } from "./flat-list";
import { IconFlag, IconRepeat } from "./icons";
import { useT } from "./language";
import { ProjectGlyph } from "./project-style";
import { Checkbox, type TaskActions } from "./task-row";

const HOUR = 48;
// Cada bloco ocupa visualmente uns 50 minutos; tarefas mais próximas que isso dividem a largura.
const SPAN = 50;

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

/** Hora atual no fuso da conta, como HH:MM. */
function useNow(timezone: string) {
  const read = () => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const [now, setNow] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setNow(read()), 30_000);
    return () => clearInterval(timer);
    // `read` só depende do fuso.
  }, [timezone]);
  return now;
}

type Placed = { task: TaskItem; start: number; lane: number; lanes: number };

/** Distribui as tarefas em faixas: as que se sobrepõem no tempo ficam lado a lado. */
function place(tasks: TaskItem[]): Placed[] {
  const sorted = tasks.map((task) => ({ task, start: minutesOf(task.dueTime!) })).sort((a, b) => a.start - b.start);
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const close = () => {
    const lanes = Math.max(1, laneEnds.length);
    cluster.forEach((item) => { item.lanes = lanes; });
    cluster = [];
    laneEnds = [];
  };
  for (const { task, start } of sorted) {
    if (start >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = start + SPAN;
    const item = { task, start, lane, lanes: 1 };
    cluster.push(item);
    placed.push(item);
    clusterEnd = Math.max(clusterEnd, start + SPAN);
  }
  close();
  return placed;
}

function TimelineBlock({ task, actions, style, compact }: { task: TaskItem; actions: TaskActions; style?: CSSProperties; compact?: boolean }) {
  const t = useT();
  const app = useApp();
  const color = projectStyle(task.origin?.isInbox ? null : task.projectId).color ?? "var(--text-2)";
  const project = task.origin ? (task.origin.isInbox ? t("Entrada") : task.origin.projectName) : null;
  return (
    <div className={`tl-block${task.status === "completed" ? " done-t" : ""}`} data-task-id={task.id} style={{ "--proj": color, ...style } as CSSProperties}>
      <Checkbox task={task} onToggle={() => actions.toggle(task)} />
      <span className="tl-time">{task.dueTime}</span>
      <button type="button" className="tl-title" onClick={() => app.openTask(task.id)}>{task.title}</button>
      {task.status === "active" && task.priority < 4 && (
        <span className={`tl-prio p${task.priority}`} aria-label={t("Prioridade {0}", [task.priority])}>
          <IconFlag className={task.priority === 1 ? "fill" : undefined} />P{task.priority}
        </span>
      )}
      {task.recurrence && (
        <span className="tl-repeat" role="img" aria-label={t("Repetir: {0}", [t(FREQUENCY_LABEL[task.recurrence.frequency])])}><IconRepeat /></span>
      )}
      {project && (
        <span className="tl-project" data-tooltip={compact ? project : undefined}>
          <ProjectGlyph id={task.origin?.isInbox ? null : task.projectId} />{!compact && <span>{project}</span>}
        </span>
      )}
    </div>
  );
}

/**
 * Linha do dia: as tarefas com horário de hoje numa régua de horas, com a hora atual marcada.
 * Atrasadas e sem horário ficam ao lado (abaixo, no celular).
 */
export function DayTimeline({ reference, timed, untimed, overdue, actions, mobile, addTask }: {
  reference: string; timed: TaskItem[]; untimed: TaskItem[]; overdue: TaskItem[];
  actions: TaskActions; mobile: boolean; addTask: ReactNode;
}) {
  const t = useT();
  const app = useApp();
  const now = useNow(app.timezone);
  const isToday = reference === app.reference;
  const nowMinutes = minutesOf(now);
  const times = timed.map((task) => minutesOf(task.dueTime!));
  const first = Math.min(8, ...times.map((value) => Math.floor(value / 60)), isToday ? Math.floor(nowMinutes / 60) : 24);
  const last = Math.max(20, ...times.map((value) => Math.floor(value / 60) + 1), isToday ? Math.ceil(nowMinutes / 60) : 0);
  const hours = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const top = (minutes: number) => (minutes - first * 60) / 60 * HOUR;
  const side = (
    <>
      {overdue.length > 0 && <FlatGroup title={t("Atrasadas")} late count={overdue.length} tasks={overdue} actions={actions} />}
      <FlatGroup title={t("Sem horário")} count={untimed.length} tasks={untimed} actions={actions}
        empty={<p className="hint tl-empty">{t("Nada sem horário hoje.")}</p>} />
      {addTask}
    </>
  );

  if (mobile) {
    const sorted = [...timed].sort((a, b) => minutesOf(a.dueTime!) - minutesOf(b.dueTime!));
    const nowIndex = isToday ? sorted.findIndex((task) => minutesOf(task.dueTime!) > nowMinutes) : -1;
    const nowLine = <div className="tl-now-row" aria-label={t("Agora, {0}", [now])}><span>{now}</span><i /></div>;
    return (
      <div className="tl-mobile">
        {overdue.length > 0 && <FlatGroup title={t("Atrasadas")} late count={overdue.length} tasks={overdue} actions={actions} />}
        <section className="tl-list" aria-label={t("Com horário")}>
          <h2 className="tl-h">{t("Com horário")}<span className="count">{timed.length}</span></h2>
          {sorted.map((task, index) => (
            <div key={task.id}>
              {index === nowIndex && nowLine}
              <TimelineBlock task={task} actions={actions} />
            </div>
          ))}
          {isToday && nowIndex < 0 && sorted.length > 0 && nowLine}
          {!sorted.length && <p className="hint tl-empty">{t("Nenhuma tarefa com horário hoje.")}</p>}
        </section>
        <FlatGroup title={t("Sem horário")} count={untimed.length} tasks={untimed} actions={actions} />
        {addTask}
      </div>
    );
  }

  return (
    <div className="tl-wrap">
      <section className="tl-day" aria-label={t("Com horário")}>
        <h2 className="tl-h">{t("Com horário")}<span className="count">{timed.length}</span></h2>
        <div className="tl-grid" style={{ height: hours.length * HOUR }}>
          {hours.map((hour) => (
            <div key={hour} className="tl-hour" style={{ top: (hour - first) * HOUR }} aria-hidden="true">
              <span>{String(hour).padStart(2, "0")}:00</span><i />
            </div>
          ))}
          {isToday && (
            <div className="tl-now" style={{ top: top(nowMinutes) }} role="img" aria-label={t("Agora, {0}", [now])}>
              <span>{now}</span><b /><i />
            </div>
          )}
          {place(timed).map(({ task, start, lane, lanes }) => (
            <TimelineBlock key={task.id} task={task} actions={actions} compact={lanes > 1}
              style={{ top: top(start) + 2, left: `calc(var(--tl-gutter) + (100% - var(--tl-gutter)) * ${lane} / ${lanes})`, width: `calc((100% - var(--tl-gutter)) / ${lanes} - 4px)`, position: "absolute" }} />
          ))}
        </div>
        {!timed.length && <p className="hint tl-empty">{t("Nenhuma tarefa com horário hoje.")}</p>}
      </section>
      <div className="tl-side">{side}</div>
    </div>
  );
}

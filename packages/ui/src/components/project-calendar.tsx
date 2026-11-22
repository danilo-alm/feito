"use client";

import {
  DndContext, DragOverlay, MouseSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectPage, TaskItem } from "@feito/core/types";
import {
  addDays, daysBetween, daysInMonth, longDate, monthStart, monthTitle, rangeLabel, weekday, weekdayShort, weekHead,
} from "../client/dates";
import { isTemporaryTask } from "../client/task-mutations";
import { useApp } from "./app";
import { exitingProps, flipFrom, usePresence } from "./motion";
import { IconCalendar, IconChevronLeft, IconChevronRight, IconPlus, IconRepeat, IconX } from "./icons";
import { useT } from "./language";
import { useTaskActions } from "./task-actions";
import { TaskRow } from "./task-row";

export type CalendarPeriod = "month" | "week";
/** Sentido da última navegação: a grade nova entra deslizando desse lado. */
type Direction = "next" | "prev" | "none";

type Actions = ReturnType<typeof useTaskActions>;
type Drop = { date: string | null; time?: string | null };

const PERIOD_KEY = "feito:calendar-period";
const NO_DATE_WIDTH_KEY = "feito:calendar-nodate-width";
export const NO_DATE_WIDTH = { default: 272, min: 220, max: 560 };
/** Espaço mínimo que a grade mantém ao lado do painel Sem data. */
const MIN_GRID_WIDTH = 360;
const MAX_CHIPS = 3;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const pad = (value: number) => String(value).padStart(2, "0");

/** O período é uma preferência de exibição do aparelho: sem armazenamento, o calendário abre no mês. */
function storedPeriod(): CalendarPeriod {
  try {
    return localStorage.getItem(PERIOD_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

function storePeriod(period: CalendarPeriod) {
  try {
    localStorage.setItem(PERIOD_KEY, period);
  } catch {
    // Sem armazenamento local, o período vale só nesta visita.
  }
}

/** Primeiro dia visível: o domingo da semana do primeiro dia do mês, ou da semana da âncora. */
export function calendarRange(anchor: string, period: CalendarPeriod) {
  if (period === "week") {
    const start = addDays(anchor, -weekday(anchor));
    return { start, days: 7 };
  }
  const first = monthStart(anchor);
  const start = addDays(first, -weekday(first));
  return { start, days: Math.ceil((weekday(first) + daysInMonth(first)) / 7) * 7 };
}

/** Sem horário primeiro (por prioridade), depois as tarefas com horário em ordem. */
export function calendarOrder(a: TaskItem, b: TaskItem) {
  if (!a.dueTime !== !b.dueTime) return a.dueTime ? 1 : -1;
  if (a.dueTime && b.dueTime && a.dueTime !== b.dueTime) return a.dueTime < b.dueTime ? -1 : 1;
  if (a.status !== b.status) return a.status === "active" ? -1 : 1;
  return a.priority - b.priority;
}

/** Data e horário que um arraste grava; `null` quando nada muda. */
export function calendarDrop(task: Pick<TaskItem, "dueDate" | "dueTime">, drop: Drop) {
  if (drop.date === null) return task.dueDate === null ? null : { dueDate: null, dueTime: null };
  if (drop.time === undefined) return drop.date === task.dueDate ? null : { dueDate: drop.date, dueTime: undefined };
  let time = drop.time;
  // Soltar na mesma hora preserva os minutos.
  if (time && task.dueTime && task.dueTime.slice(0, 2) === time.slice(0, 2)) time = task.dueTime;
  if (drop.date === task.dueDate && time === task.dueTime) return null;
  return { dueDate: drop.date, dueTime: time };
}

function parseDrop(id: string): Drop | null {
  if (id === "nodate") return { date: null };
  const [kind, date, hour] = id.split("|");
  if (kind === "day") return { date };
  if (kind === "allday") return { date, time: null };
  if (kind === "hour") return { date, time: `${hour}:00` };
  return null;
}

/** Limites da largura do painel Sem data para a largura disponível ao lado da grade. */
export function noDateWidthLimits(bodyWidth: number) {
  const max = Math.max(NO_DATE_WIDTH.min, Math.min(NO_DATE_WIDTH.max, bodyWidth - MIN_GRID_WIDTH));
  return { min: NO_DATE_WIDTH.min, max };
}

function storedNoDateWidth() {
  try {
    const saved = Number(localStorage.getItem(NO_DATE_WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : NO_DATE_WIDTH.default;
  } catch {
    return NO_DATE_WIDTH.default;
  }
}

function storeNoDateWidth(width: number) {
  try {
    localStorage.setItem(NO_DATE_WIDTH_KEY, String(width));
  } catch {
    // Sem armazenamento local, a largura vale só nesta visita.
  }
}

function nowIn(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: value("hour"), minute: value("minute") };
}

export function CalendarLayout({ page, actions, archived, mobile }: {
  page: ProjectPage; actions: Actions; archived: boolean; mobile: boolean;
}) {
  const t = useT();
  const app = useApp();
  const reference = app.reference;
  const [period, setPeriodState] = useState<CalendarPeriod>("month");
  const [anchor, setAnchor] = useState(reference);
  const [noDateOpen, setNoDateOpen] = useState(true);
  const [dragging, setDragging] = useState<TaskItem | null>(null);
  const [direction, setDirection] = useState<Direction>("none");
  useEffect(() => setPeriodState(storedPeriod()), []);

  const setPeriod = (next: CalendarPeriod) => {
    if (next === period) return;
    setDirection("none");
    setPeriodState(next);
    storePeriod(next);
  };
  const { start, days } = calendarRange(anchor, period);
  const dates = useMemo(() => Array.from({ length: days }, (_, index) => addDays(start, index)), [start, days]);
  const byDate = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const task of page.tasks) {
      if (!task.dueDate) continue;
      const list = map.get(task.dueDate) ?? [];
      list.push(task);
      map.set(task.dueDate, list);
    }
    for (const list of map.values()) list.sort(calendarOrder);
    return map;
  }, [page.tasks]);
  const undated = page.tasks.filter((task) => !task.dueDate && task.status === "active");

  const move = (step: number) => {
    setDirection(step > 0 ? "next" : "prev");
    setAnchor((current) => period === "month" ? monthStart(current, step) : addDays(current, step * 7));
  };
  const goToday = () => {
    if (calendarRange(reference, period).start === start) return;
    setDirection(reference > anchor ? "next" : "prev");
    setAnchor(reference);
  };
  // Cada período exibido é uma "página": a chave troca e a grade nova entra com a animação de `.pcal-view`.
  const view = `${period}:${start}`;
  const flipKey = (id: string) => `cal:${view}:${id}`;
  const title = period === "month" ? monthTitle(anchor) : rangeLabel(start, addDays(start, 6));
  const addOn = (date: string | null) => app.openQuickAdd({ projectId: page.project.id, sectionId: null, dueDate: date });

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }));
  const onDragStart = (event: DragStartEvent) => setDragging(page.tasks.find((task) => task.id === event.active.id) ?? null);
  const onDragEnd = (event: DragEndEvent) => {
    // O chip assenta no destino a partir de onde a prévia foi solta.
    flipFrom(flipKey(String(event.active.id)), document.querySelector<HTMLElement>(".pcal-drag"));
    setDragging(null);
    const task = page.tasks.find((item) => item.id === event.active.id);
    const drop = event.over ? parseDrop(String(event.over.id)) : null;
    if (!task || !drop) return;
    const change = calendarDrop(task, drop);
    if (change) void actions.reschedule(task, change.dueDate, change.dueTime);
  };

  const toolbar = (
    <div className="pcal-bar">
      <div className="pcal-nav">
        <button type="button" className="icon-btn" aria-label={period === "month" ? t("Mês anterior") : t("Semana anterior")}
          data-tooltip={period === "month" ? t("Mês anterior") : t("Semana anterior")} onClick={() => move(-1)}><IconChevronLeft /></button>
        <button type="button" className="btn" onClick={goToday}>{t("Hoje")}</button>
        <button type="button" className="icon-btn" aria-label={period === "month" ? t("Próximo mês") : t("Próxima semana")}
          data-tooltip={period === "month" ? t("Próximo mês") : t("Próxima semana")} onClick={() => move(1)}><IconChevronRight /></button>
      </div>
      <h2 className="pcal-title" aria-live="polite"><span key={title} className="pcal-title-text" data-dir={direction}>{title}</span></h2>
      <div className="seg compact pcal-period" data-period={period} role="radiogroup" aria-label={t("Período do calendário")}>
        {(["month", "week"] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={period === value}
            className={`seg-o${period === value ? " on" : ""}`} onClick={() => setPeriod(value)}>
            {value === "month" ? t("Mês") : t("Semana")}
          </button>
        ))}
      </div>
      {!mobile && (
        <button type="button" className={`btn${noDateOpen ? " on" : ""}`} aria-expanded={noDateOpen} aria-controls="pcal-nodate"
          onClick={() => setNoDateOpen((open) => !open)}>
          <IconCalendar />{t("Sem data")}<span key={undated.length} className="badge pcal-count">{undated.length}</span>
        </button>
      )}
    </div>
  );

  if (mobile) {
    return (
      <div className="content pcal">
        {toolbar}
        <div key={view} className="pcal-view" data-dir={direction}>
          <MobileCalendar dates={dates} period={period} anchor={anchor} byDate={byDate} undated={undated}
            actions={actions} archived={archived} onAdd={addOn} />
        </div>
      </div>
    );
  }

  // A chave de animação muda com o período exibido: trocar de mês ou de semana não desliza os chips pela grade.
  const chip = (task: TaskItem) => (
    <CalendarChip key={task.id} task={task} disabled={archived} flip={flipKey(task.id)} />
  );

  return (
    <div className="content pcal">
      {toolbar}
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
        accessibility={{ screenReaderInstructions: { draggable: t("Para mudar a data sem arrastar, abra a tarefa e use o campo de data.") } }}>
        <div className="pcal-body">
          <div className="pcal-scroll">
            <div key={view} className="pcal-view" data-dir={direction}>
              {period === "month"
                ? <MonthGrid dates={dates} anchor={anchor} reference={reference} byDate={byDate} chip={chip}
                  onAdd={archived ? undefined : addOn} />
                : <WeekGrid dates={dates} reference={reference} timezone={app.timezone} byDate={byDate} chip={chip}
                  onAdd={archived ? undefined : addOn} />}
            </div>
          </div>
          <NoDatePanel open={noDateOpen} tasks={undated} chip={chip} onClose={() => setNoDateOpen(false)}
            onAdd={archived ? undefined : () => addOn(null)} />
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && <div className={`drag-overlay pcal-drag p${dragging.priority}`}><ChipBody task={dragging} /></div>}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function ChipBody({ task }: { task: TaskItem }) {
  const t = useT();
  return (
    <>
      <span className="pcal-ring" aria-hidden="true" />
      <span className="pcal-name">{task.title}</span>
      {task.recurrence && <IconRepeat className="sm pcal-rep" label={t("Recorrente")} />}
      {task.dueTime && <span className="pcal-time">{task.dueTime}</span>}
    </>
  );
}

function CalendarChip({ task, disabled, flip }: { task: TaskItem; disabled: boolean; flip: string }) {
  const app = useApp();
  const locked = disabled || task.status !== "active" || isTemporaryTask(task.id);
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: task.id, disabled: locked });
  const classes = ["pcal-chip", `p${task.priority}`, task.status === "completed" ? "done" : "", task.overdue ? "late" : "",
    isDragging ? "drag-src" : ""].filter(Boolean).join(" ");
  return (
    <button ref={setNodeRef} type="button" className={classes} data-task-id={task.id} data-flip={flip} onClick={() => app.openTask(task.id)}
      {...listeners} aria-describedby={attributes["aria-describedby"]}>
      <ChipBody task={task} />
    </button>
  );
}

function DayDrop({ id, className, label, children }: { id: string; className: string; label?: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className}${isOver ? " target" : ""}`} role="group" aria-label={label}>{children}</div>;
}

function MonthGrid({ dates, anchor, reference, byDate, chip, onAdd }: {
  dates: string[]; anchor: string; reference: string; byDate: Map<string, TaskItem[]>;
  chip: (task: TaskItem) => ReactNode; onAdd?: (date: string) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<string | null>(null);
  const month = monthStart(anchor);
  return (
    <div className="pcal-month">
      <div className="pcal-dows" aria-hidden="true">
        {dates.slice(0, 7).map((date) => <span key={date}>{weekdayShort(date)}</span>)}
      </div>
      <div className="pcal-cells">
        {dates.map((date) => {
          const tasks = byDate.get(date) ?? [];
          const open = expanded === date;
          const shown = open ? tasks : tasks.slice(0, MAX_CHIPS);
          const label = longDate(date);
          const classes = ["pcal-cell", monthStart(date) !== month ? "out" : "", date === reference ? "today" : "",
            weekday(date) % 6 === 0 ? "weekend" : ""].filter(Boolean).join(" ");
          return (
            <DayDrop key={date} id={`day|${date}`} className={classes} label={label}>
              <div className="pcal-dhead">
                <span className="pcal-dnum" aria-current={date === reference ? "date" : undefined}>{Number(date.slice(8))}</span>
                {onAdd && (
                  <button type="button" className="pcal-add" aria-label={t("Adicionar tarefa em {0}", [label])}
                    onClick={() => onAdd(date)}><IconPlus /></button>
                )}
              </div>
              {shown.map(chip)}
              {tasks.length > MAX_CHIPS && (
                <button type="button" className="pcal-more" aria-expanded={open} onClick={() => setExpanded(open ? null : date)}>
                  {open ? t("Mostrar menos") : t("+{0} mais", [tasks.length - MAX_CHIPS])}
                </button>
              )}
            </DayDrop>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ dates, reference, timezone, byDate, chip, onAdd }: {
  dates: string[]; reference: string; timezone: string; byDate: Map<string, TaskItem[]>;
  chip: (task: TaskItem) => ReactNode; onAdd?: (date: string) => void;
}) {
  const t = useT();
  const week = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<{ hour: number; minute: number } | null>(null);
  useEffect(() => {
    const tick = () => setNow(nowIn(timezone));
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [timezone]);
  useEffect(() => {
    // Abre a grade no começo do dia útil, sem mexer na rolagem da página.
    const grid = week.current;
    const box = grid?.parentElement;
    const row = grid?.querySelector<HTMLElement>("[data-hour='8']");
    const top = grid?.querySelector<HTMLElement>(".pcal-wtop");
    if (!box || !row || !top) return;
    box.scrollTop = row.offsetTop - top.offsetHeight;
    box.scrollLeft = 0;
  }, []);
  return (
    <div className="pcal-week" ref={week}>
      <div className="pcal-wtop">
        <div className="pcal-wrow pcal-whead">
          <span />
          {dates.map((date) => (
            <div key={date} className={`pcal-wday${date === reference ? " today" : ""}`}>
              <span className="pcal-wd">{weekdayShort(date)}</span>
              <span className="pcal-dnum" aria-current={date === reference ? "date" : undefined}>{Number(date.slice(8))}</span>
              {onAdd && (
                <button type="button" className="pcal-add" aria-label={t("Adicionar tarefa em {0}", [longDate(date)])}
                  onClick={() => onAdd(date)}><IconPlus /></button>
              )}
            </div>
          ))}
        </div>
        <div className="pcal-wrow pcal-allday">
          <span className="pcal-hour">{t("Sem horário")}</span>
          {dates.map((date) => (
            <DayDrop key={date} id={`allday|${date}`} className="pcal-wcell" label={t("{0}, sem horário", [longDate(date)])}>
              {(byDate.get(date) ?? []).filter((task) => !task.dueTime).map(chip)}
            </DayDrop>
          ))}
        </div>
      </div>
      <div className="pcal-hours">
        {HOURS.map((hour) => (
          <div key={hour} className="pcal-wrow" data-hour={hour}>
            <span className="pcal-hour">{pad(hour)}:00</span>
            {dates.map((date) => {
              const tasks = (byDate.get(date) ?? []).filter((task) => task.dueTime && Number(task.dueTime.slice(0, 2)) === hour);
              const current = now && date === reference && now.hour === hour;
              return (
                <DayDrop key={date} id={`hour|${date}|${pad(hour)}`} className={`pcal-wcell${daysBetween(reference, date) === 0 ? " today" : ""}`}
                  label={`${longDate(date)}, ${pad(hour)}:00`}>
                  {current && <span className="pcal-now" style={{ top: `${(now.minute / 60) * 100}%` }} aria-hidden="true" />}
                  {tasks.map(chip)}
                </DayDrop>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function NoDatePanel({ open, tasks, chip, onClose, onAdd }: {
  open: boolean; tasks: TaskItem[]; chip: (task: TaskItem) => ReactNode; onClose: () => void; onAdd?: () => void;
}) {
  const t = useT();
  const { mounted, state } = usePresence(open, { enter: "base", exit: "fast", appear: false });
  const { setNodeRef, isOver } = useDroppable({ id: "nodate" });
  const panel = useRef<HTMLElement | null>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(NO_DATE_WIDTH.default);
  const [limits, setLimits] = useState(() => noDateWidthLimits(Infinity));
  const drag = useRef<{ x: number; width: number; current: number } | null>(null);
  const width = Math.max(limits.min, Math.min(limits.max, preferred));

  useEffect(() => setPreferred(storedNoDateWidth()), []);
  useEffect(() => {
    const body = panel.current?.parentElement;
    if (!body) return;
    const measure = () => setLimits((previous) => {
      const next = noDateWidthLimits(body.getBoundingClientRect().width);
      return previous.min === next.min && previous.max === next.max ? previous : next;
    });
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    measure();
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("panel-resizing");
    };
  }, [mounted]);

  const resize = (next: number, persist = true) => {
    const clamped = Math.round(Math.max(limits.min, Math.min(limits.max, next)));
    setPreferred(clamped);
    if (drag.current) drag.current.current = clamped;
    if (persist) storeNoDateWidth(clamped);
  };
  const finishDrag = () => {
    if (drag.current) {
      storeNoDateWidth(drag.current.current);
      handle.current?.blur();
    }
    drag.current = null;
    document.documentElement.classList.remove("panel-resizing");
  };
  const setRef = (node: HTMLElement | null) => {
    panel.current = node;
    setNodeRef(node);
  };

  if (!mounted) return null;
  return (
    <aside id="pcal-nodate" ref={setRef} className={`pcal-nodate${isOver ? " target" : ""}`} aria-label={t("Tarefas sem data")}
      style={{ flexBasis: width }} data-state={state} {...exitingProps(state)}>
      {/* O painel fica à direita: arrastar ou usar a seta para a esquerda o alarga. */}
      <div ref={handle} className="pcal-resize" role="separator" tabIndex={0} aria-orientation="vertical"
        aria-label={t("Redimensionar painel Sem data")} title={t("Arraste ou use as setas para redimensionar")}
        aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={width}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width, current: width };
          document.documentElement.classList.add("panel-resizing");
        }}
        onPointerMove={(event) => {
          if (drag.current) resize(drag.current.width - (event.clientX - drag.current.x), false);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          finishDrag();
        }}
        onLostPointerCapture={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={() => resize(NO_DATE_WIDTH.default)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 32 : 8;
          const next = event.key === "ArrowLeft" ? width + step : event.key === "ArrowRight" ? width - step
            : event.key === "Home" ? limits.min : event.key === "End" ? limits.max : undefined;
          if (next === undefined) return;
          event.preventDefault();
          resize(next);
        }} />
      <div className="pcal-nodate-h">
        <h3>{t("Sem data")}</h3>
        <button type="button" className="icon-btn" aria-label={t("Fechar painel Sem data")} onClick={onClose}><IconX /></button>
      </div>
      <p className="hint">{t("Arraste para um dia para definir a data planejada.")}</p>
      <div className="pcal-nodate-list">
        {tasks.length ? tasks.map(chip) : <p className="hint">{t("Nenhuma tarefa sem data.")}</p>}
      </div>
      {onAdd && (
        <button type="button" className="add-task" onClick={onAdd}><span className="plus"><IconPlus /></span>{t("Adicionar tarefa sem data")}</button>
      )}
    </aside>
  );
}

function MobileCalendar({ dates, period, anchor, byDate, undated, actions, archived, onAdd }: {
  dates: string[]; period: CalendarPeriod; anchor: string; byDate: Map<string, TaskItem[]>; undated: TaskItem[];
  actions: Actions; archived: boolean; onAdd: (date: string | null) => void;
}) {
  const t = useT();
  const app = useApp();
  const reference = app.reference;
  const inRange = (date: string) => dates.includes(date) && (period === "week" || monthStart(date) === monthStart(anchor));
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked && inRange(picked) ? picked : inRange(reference) ? reference : period === "month" ? monthStart(anchor) : dates[0];
  const [showUndated, setShowUndated] = useState(false);
  const tasks = byDate.get(selected) ?? [];
  const month = monthStart(anchor);
  return (
    <>
      <div className="pcal-mgrid">
        {weekHead().map((day, index) => <span key={index} className="pcal-mdow" aria-hidden="true">{day}</span>)}
        {dates.map((date) => {
          const dots = (byDate.get(date) ?? []).filter((task) => task.status === "active").slice(0, 3);
          const classes = ["pcal-mday", period === "month" && monthStart(date) !== month ? "out" : "",
            date === reference ? "today" : "", date === selected ? "sel" : ""].filter(Boolean).join(" ");
          return (
            <button key={date} type="button" className={classes} aria-pressed={date === selected}
              aria-label={t("{0}, {1} tarefas", [longDate(date), (byDate.get(date) ?? []).length])} onClick={() => setPicked(date)}>
              <span className="n">{Number(date.slice(8))}</span>
              <span className="pcal-dots" aria-hidden="true">{dots.map((task) => <span key={task.id} className={`p${task.priority}`} />)}</span>
            </button>
          );
        })}
      </div>
      <section key={selected} className="pcal-agenda" aria-label={longDate(selected)}>
        <div className="sec-h">{selected === reference ? `${t("Hoje")} · ${longDate(selected)}` : longDate(selected)}
          <span className="count">{tasks.length}</span></div>
        {tasks.map((task) => <TaskRow key={task.id} task={task} actions={actions} timeOnly />)}
        {!tasks.length && <p className="hint pcal-empty">{t("Nenhuma tarefa neste dia.")}</p>}
        {!archived && (
          <button type="button" className="add-task" onClick={() => onAdd(selected)}>
            <span className="plus"><IconPlus /></span>{t("Adicionar tarefa em {0}", [longDate(selected)])}</button>
        )}
        <button type="button" className="add-sec-m pcal-undated" aria-expanded={showUndated} onClick={() => setShowUndated((open) => !open)}>
          {t("Sem data")}<span className="count">{undated.length}</span>
        </button>
        {showUndated && undated.map((task) => <TaskRow key={task.id} task={task} actions={actions} />)}
      </section>
    </>
  );
}

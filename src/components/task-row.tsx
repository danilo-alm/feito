"use client";
import { forwardRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { addDays, completedLabel, dateLabel, dueLabel, FREQUENCY_LABEL, nextWeek } from "@/client/dates";
import type { TaskItem } from "@/client/types";
import { useApp } from "./app";
import {
  IconArrowDown, IconArrowUp, IconCalendar, IconCheck, IconFlag, IconGrip, IconHash, IconMore, IconMove, IconPromote,
  IconRepeat, IconSub, IconTag, IconTrash, IconX,
} from "./icons";
import type { useTaskActions } from "./task-actions";
import { MenuButton, Popover, type MenuItem } from "./ui";

export type TaskActions = ReturnType<typeof useTaskActions>;

export function priorityAria(task: Pick<TaskItem, "priority" | "title" | "status">) {
  const level = task.priority < 4 ? `prioridade ${task.priority}` : "sem prioridade";
  return `${task.status === "completed" ? "Reabrir" : "Concluir"} “${task.title}”, ${level}`;
}

export function TaskMeta({ task, reference, showOrigin, timezone, timeOnly }: {
  task: TaskItem; reference: string; showOrigin?: boolean; timezone?: string; timeOnly?: boolean;
}) {
  const due = timeOnly ? task.dueTime : dueLabel(task.dueDate, task.dueTime, reference);
  const dateClass = task.overdue ? "late" : task.dueDate === reference ? "today" : "";
  const items: ReactNode[] = [];
  if (task.status === "completed" && task.completedAt) {
    items.push(<span key="done">{completedLabel(task.completedAt, reference, timezone)}</span>);
  } else if (due) {
    items.push(<span key="d" className={`m-date ${dateClass}`}><IconCalendar />{due}{task.overdue ? <span className="sr-only"> (atrasada)</span> : null}</span>);
  }
  if (task.recurrence) items.push(<span key="r"><IconRepeat />{FREQUENCY_LABEL[task.recurrence.frequency]}</span>);
  if (task.origin?.parentTitle) items.push(<span key="p"><IconSub />em {task.origin.parentTitle}</span>);
  if (task.subtasks.total > 0) {
    items.push(<span key="s" aria-label={`${task.subtasks.completed} de ${task.subtasks.total} subtarefas concluídas`}>
      <IconSub />{task.subtasks.completed}/{task.subtasks.total}</span>);
  }
  if (task.priority < 4) items.push(<span key="f" className="m-prio"><IconFlag />P{task.priority}</span>);
  for (const label of task.labels) items.push(<span key={`l${label.id}`}><IconTag />{label.name}</span>);
  if (showOrigin && task.origin) {
    const where = task.origin.isInbox ? "Caixa de entrada"
      : task.origin.sectionName ? `${task.origin.projectName} / ${task.origin.sectionName}` : task.origin.projectName;
    items.push(<span key="o" className="m-origin"><IconHash />{where}</span>);
  }
  if (!items.length) return null;
  return <div className={`t-meta p${task.priority}`}>{items}</div>;
}

export function Checkbox({ task, onToggle, disabled }: { task: TaskItem; onToggle: () => void; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const done = task.status === "completed" || pending;
  return (
    <button
      type="button"
      className={`chk p${task.priority}${done ? " done" : ""}`}
      aria-label={priorityAria(task)}
      aria-pressed={task.status === "completed"}
      disabled={disabled || pending}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={async (event) => {
        event.stopPropagation();
        if (task.status === "active") setPending(true);
        try {
          await onToggle();
        } finally {
          setPending(false);
        }
      }}
    >
      <span className="ring"><IconCheck /></span>
    </button>
  );
}

export function DatePicker({ value, reference, onPick, onClose, allowClear = true }: {
  value: string | null; reference: string; onPick: (date: string | null) => void; onClose: () => void; allowClear?: boolean;
}) {
  const options = [
    { label: "Hoje", date: reference },
    { label: "Amanhã", date: addDays(reference, 1) },
    { label: "Próxima semana", date: nextWeek(reference) },
  ];
  return (
    <div className="date-pop">
      {options.map((option) => (
        <button key={option.label} type="button" className="mi" onClick={() => { onPick(option.date); onClose(); }}>
          <IconCalendar /><span style={{ flex: 1 }}>{option.label}</span>
          <span className="sub">{dateLabel(option.date, reference) === option.label ? "" : dateLabel(option.date, reference)}</span>
        </button>
      ))}
      <label className="lbl" style={{ padding: "8px 4px 2px" }} htmlFor="date-pick">Escolher data</label>
      <input id="date-pick" type="date" defaultValue={value ?? ""} onChange={(event) => {
        if (event.target.value) {
          onPick(event.target.value);
          onClose();
        }
      }} />
      {allowClear && value && (
        <button type="button" className="mi" style={{ marginTop: 4 }} onClick={() => { onPick(null); onClose(); }}>
          <IconX /><span>Sem data</span>
        </button>
      )}
    </div>
  );
}

function DateButton({ task, actions, reference }: { task: TaskItem; actions: TaskActions; reference: string }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={setAnchor} type="button" className="icon-btn" aria-label={`Agendar “${task.title}”`} aria-haspopup="dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
        <IconCalendar />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Agendar" align="end">
        <DatePicker value={task.dueDate} reference={reference} onClose={() => setOpen(false)}
          allowClear={!task.recurrence} onPick={(date) => void actions.reschedule(task, date)} />
      </Popover>
    </>
  );
}

export type ArrangeItem = { action: "up" | "down" | "nest" | "promote"; label: string; key: string };
const ARRANGE_ICONS = { up: <IconArrowUp />, down: <IconArrowDown />, nest: <IconSub />, promote: <IconPromote /> };

export function taskMenu(task: TaskItem, actions: TaskActions, open: () => void, arrange: ArrangeItem[] = [], onArrange?: (action: ArrangeItem["action"]) => void): MenuItem[] {
  const items: MenuItem[] = arrange.map((item) => ({
    label: item.label, shortcut: item.key, icon: ARRANGE_ICONS[item.action], onSelect: () => onArrange?.(item.action),
  }));
  if (items.length) items.push("separator");
  if (task.status === "active") items.push({ label: "Mover para…", icon: <IconMove />, onSelect: () => actions.openMove(task) });
  items.push({ label: task.status === "active" ? "Abrir detalhe" : "Abrir para reabrir", icon: <IconCalendar />, onSelect: open });
  items.push("separator", { label: "Excluir…", icon: <IconTrash />, danger: true, onSelect: () => void actions.remove(task) });
  return items;
}

type RowProps = HTMLAttributes<HTMLDivElement> & {
  task: TaskItem;
  actions: TaskActions;
  showOrigin?: boolean;
  grip?: boolean;
  tag?: ReactNode;
  arrange?: ArrangeItem[];
  onArrange?: (action: ArrangeItem["action"]) => void;
  onKeyArrange?: (event: KeyboardEvent<HTMLDivElement>) => void;
  variant?: "row" | "card";
  extraClass?: string;
  noMenu?: boolean;
  timeOnly?: boolean;
};

export const TaskRow = forwardRef<HTMLDivElement, RowProps>(function TaskRow({
  task, actions, showOrigin, grip, tag, arrange, onArrange, onKeyArrange, variant = "row", extraClass = "", noMenu, timeOnly, ...rest
}, ref) {
  const app = useApp();
  const open = () => app.openTask(task.id);
  const sub = variant === "row" && !!task.parentId && !showOrigin;
  const classes = [variant === "card" ? "card" : "task", sub ? "sub" : "", task.status === "completed" ? "done-t" : "", extraClass]
    .filter(Boolean).join(" ");
  return (
    <div ref={ref} className={classes} data-task-id={noMenu ? undefined : task.id} onKeyDown={onKeyArrange} {...rest}>
      {grip && variant === "row" && <span className="grip" aria-hidden="true"><IconGrip /></span>}
      <Checkbox task={task} onToggle={() => actions.toggle(task)} />
      <button type="button" className="t-click" onClick={open} aria-describedby={undefined}>
        <div className="t-body">
          <div className="t-title">{task.title}</div>
          {task.descriptionExcerpt && <div className="t-desc">{task.descriptionExcerpt}</div>}
          <TaskMeta task={task} reference={app.reference} showOrigin={showOrigin} timezone={app.timezone} timeOnly={timeOnly && !task.overdue} />
        </div>
      </button>
      {tag}
      {!noMenu && (
        <div className="t-acts" style={variant === "card" ? { opacity: 1, margin: "-4px -6px 0 0" } : undefined}>
          {variant === "row" && task.status === "active" && <span className="desktop-only"><DateButton task={task} actions={actions} reference={app.reference} /></span>}
          <MenuButton label={`Ações de “${task.title}”`} title={task.title}
            items={() => taskMenu(task, actions, open, arrange, onArrange)}>
            <IconMore />
          </MenuButton>
        </div>
      )}
    </div>
  );
});

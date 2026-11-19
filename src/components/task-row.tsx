"use client";
import { forwardRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { addDays, dayOfMonth, nextWeek, shortDate, weekend } from "@/client/dates";
import { editKey, openEditor, useEditorOpen } from "@/client/editor-store";
import type { Priority, TaskItem } from "@/client/types";
import { useApp } from "./app";
import {
  IconArrowDown, IconArrowUp, IconBan, IconCalendar, IconCalendarDay, IconCheck, IconCopy, IconEdit, IconFlag, IconGrip,
  IconInsertAbove, IconInsertBelow, IconMore, IconMove, IconNextWeek, IconPromote, IconSofa, IconSub, IconSun,
  IconTrash,
} from "./icons";
import { DatePicker, PRIORITY_NAMES } from "./pickers";
import type { useTaskActions } from "./task-actions";
import { TaskContent } from "./task-content";
import { InlineEdit } from "./task-editor";
import { MenuButton, Popover, useIsMobile, type MenuItem } from "./ui";

export type TaskActions = ReturnType<typeof useTaskActions>;

export function priorityAria(task: Pick<TaskItem, "priority" | "title" | "status">) {
  const level = task.priority < 4 ? `prioridade ${task.priority}` : "sem prioridade";
  return `${task.status === "completed" ? "Reabrir" : "Concluir"} “${task.title}”, ${level}`;
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

export type ArrangeItem = { action: "up" | "down" | "nest" | "promote"; label: string; key: string };
const ARRANGE_ICONS = { up: <IconArrowUp />, down: <IconArrowDown />, nest: <IconSub />, promote: <IconPromote /> };
export type InsertSide = "above" | "below";

/** Menu "⋯" da tarefa: inserir perto, editar, datas e prioridades rápidas, organizar, mover, duplicar, excluir. */
export function taskMenu({ task, actions, reference, edit, datePicker, insert, arrange = [], onArrange }: {
  task: TaskItem;
  actions: TaskActions;
  reference: string;
  edit: () => void;
  /** Calendário aberto por cima do menu em "Escolher data…"; `close` fecha o calendário e o menu. */
  datePicker: (close: () => void) => ReactNode;
  insert?: (side: InsertSide) => void;
  arrange?: ArrangeItem[];
  onArrange?: (action: ArrangeItem["action"]) => void;
}): MenuItem[] {
  const items: MenuItem[] = [];
  const active = task.status === "active";
  if (active && insert) {
    items.push(
      { label: "Adicionar tarefa acima", icon: <IconInsertAbove />, onSelect: () => insert("above") },
      { label: "Adicionar tarefa abaixo", icon: <IconInsertBelow />, onSelect: () => insert("below") },
      "separator",
    );
  }
  if (active) {
    const dates = [
      { label: "Hoje", date: reference, icon: <IconCalendarDay day={dayOfMonth(reference)} />, className: "c-today" },
      { label: "Amanhã", date: addDays(reference, 1), icon: <IconSun />, className: "c-tomorrow" },
      { label: "Fim de semana", date: weekend(reference), icon: <IconSofa />, className: "c-weekend" },
      { label: "Próxima semana", date: nextWeek(reference), icon: <IconNextWeek />, className: "c-week" },
    ];
    items.push(
      { label: "Editar", icon: <IconEdit />, onSelect: edit },
      "separator",
      {
        kind: "choices",
        label: "Data",
        options: [
          ...dates.map((option) => ({
            label: `${option.label} · ${shortDate(option.date)}`, icon: option.icon, className: option.className,
            active: task.dueDate === option.date, onSelect: () => void actions.reschedule(task, option.date),
          })),
          ...(task.dueDate && !task.recurrence
            ? [{ label: "Sem data", icon: <IconBan />, onSelect: () => void actions.reschedule(task, null) }] : []),
          { label: "Escolher data…", icon: <IconMore />, popover: datePicker },
        ],
      },
      {
        kind: "choices",
        label: "Prioridade",
        options: ([1, 2, 3, 4] as Priority[]).map((priority) => ({
          label: PRIORITY_NAMES[priority], icon: <IconFlag />, className: `mflag p${priority}`,
          active: task.priority === priority, onSelect: () => void actions.setPriority(task, priority),
        })),
      },
      "separator",
    );
  }
  for (const item of arrange) {
    items.push({ label: item.label, shortcut: item.key, icon: ARRANGE_ICONS[item.action], onSelect: () => onArrange?.(item.action) });
  }
  if (arrange.length) items.push("separator");
  if (active) {
    items.push(
      { label: "Mover para…", icon: <IconMove />, onSelect: () => actions.openMove(task) },
      { label: "Duplicar", icon: <IconCopy />, onSelect: () => void actions.duplicate(task) },
    );
  } else {
    items.push({ label: "Reabrir", icon: <IconCheck />, onSelect: () => void actions.reopen(task) });
  }
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
  /** Inserir uma tarefa acima ou abaixo (só com ordenação manual). */
  insert?: (side: InsertSide) => void;
  variant?: "row" | "card";
  depth?: number;
  showMoreSubtasks?: boolean;
  extraClass?: string;
  noMenu?: boolean;
  timeOnly?: boolean;
};

export const TaskRow = forwardRef<HTMLDivElement, RowProps>(function TaskRow({
  task, actions, showOrigin, grip, tag, arrange, onArrange, onKeyArrange, insert, variant = "row",
  depth = task.parentId && !showOrigin ? 1 : 0, showMoreSubtasks, extraClass = "", noMenu, timeOnly, style, ...rest
}, ref) {
  const app = useApp();
  const mobile = useIsMobile();
  const editing = useEditorOpen(editKey(task)) && !noMenu;
  const [dateOpen, setDateOpen] = useState(false);
  const [acts, setActs] = useState<HTMLDivElement | null>(null);
  // Em edição, o editor rápido ocupa o lugar da tarefa (sem os atributos de arraste da linha).
  const indent = { "--task-depth": depth } as CSSProperties;
  if (editing) return depth
    ? <div className="task-tree-inset" style={indent}><InlineEdit task={task} /></div>
    : <InlineEdit task={task} />;

  const open = () => app.openTask(task.id);
  const edit = () => (mobile ? open() : openEditor({ kind: "edit", key: editKey(task), taskId: task.id }));
  const active = task.status === "active";
  const showShortcuts = active && variant === "row";
  const sub = depth > 0;
  const classes = [variant === "card" ? "card" : "task", sub ? "sub" : "", task.status === "completed" ? "done-t" : "", extraClass]
    .filter(Boolean).join(" ");
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div ref={ref} className={classes} data-task-id={noMenu ? undefined : task.id} onKeyDown={onKeyArrange} style={{ ...indent, ...style }} {...rest}>
      {grip && variant === "row" && <span className="grip" aria-hidden="true"><IconGrip /></span>}
      <Checkbox task={task} onToggle={() => actions.toggle(task)} />
      <TaskContent task={task} actions={actions} showOrigin={showOrigin} timeOnly={timeOnly} preview={noMenu} showMoreSubtasks={showMoreSubtasks} />
      {tag}
      {!noMenu && (
        <div ref={setActs} className="t-acts" style={variant === "card" ? { margin: "-4px -6px 0 0" } : undefined}>
          {showShortcuts && (
            <>
              <button type="button" className="icon-btn desktop-only" aria-label={`Editar “${task.title}”`} title="Editar"
                onPointerDown={stop} onClick={(event) => { stop(event); edit(); }}>
                <IconEdit />
              </button>
              <button type="button" className="icon-btn desktop-only" aria-label={`Agendar “${task.title}”`} title="Data"
                aria-haspopup="dialog" aria-expanded={dateOpen}
                onPointerDown={stop} onClick={(event) => { stop(event); setDateOpen((value) => !value); }}>
                <IconCalendar />
              </button>
            </>
          )}
          <MenuButton label={`Ações de “${task.title}”`} title={task.title}
            items={() => taskMenu({
              task, actions, reference: app.reference, edit, insert, arrange, onArrange,
              datePicker: (close) => (
                <DatePicker value={task.dueDate} reference={app.reference} onClose={close}
                  allowClear={!task.recurrence} onPick={(date) => void actions.reschedule(task, date)} />
              ),
            })}>
            <IconMore />
          </MenuButton>
          {showShortcuts && (
            <Popover anchor={acts} open={dateOpen} onClose={() => setDateOpen(false)} label="Agendar" align="end">
              <DatePicker value={task.dueDate} reference={app.reference} onClose={() => setDateOpen(false)}
                allowClear={!task.recurrence} onPick={(date) => void actions.reschedule(task, date)} />
            </Popover>
          )}
        </div>
      )}
    </div>
  );
});

"use client";

import { translate as t } from "../client/locale";
import { useT } from "./language";

import { forwardRef, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type MouseEventHandler, type PointerEvent, type ReactNode } from "react";
import { addDays, dayOfMonth, nextWeek, shortDate, weekend } from "../client/dates";
import { editKey, openEditor, useEditorOpen } from "../client/editor-store";
import { isTemporaryTask } from "../client/task-mutations";
import type { Priority, TaskItem } from "@feito/core/types";
import { useApp } from "./app";
import {
  IconArrowDown, IconArrowUp, IconBan, IconCalendar, IconCalendarDay, IconCheck, IconChevronDown, IconCopy, IconEdit, IconFlag, IconGrip,
  IconInsertAbove, IconInsertBelow, IconMore, IconMove, IconNextWeek, IconPromote, IconSofa, IconSub, IconSun,
  IconTrash,
} from "./icons";
import { DatePicker, PRIORITY_NAMES } from "./pickers";
import { isDragActive, LONG_PRESS_MS, LONG_PRESS_TOLERANCE, swallowReleaseClick } from "./drag-pointer";
import type { useTaskActions } from "./task-actions";
import { TaskContent } from "./task-content";
import { InlineEdit } from "./task-editor";
import { MenuButton, Popover, useContextMenu, useIsMobile, type MenuItem } from "./ui";

export type TaskActions = ReturnType<typeof useTaskActions>;

export function priorityAria(task: Pick<TaskItem, "priority" | "title" | "status">) {
  const level = task.priority < 4 ? t("prioridade {0}", [task.priority]) : t("sem prioridade");
  return `${task.status === "completed" ? t("Reabrir") : t("Concluir")} “${task.title}”, ${level}`;
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

/** Seta à esquerda da bolinha das tarefas com subtarefas à vista: aponta para baixo aberta e para cima recolhida. */
export type SubtaskToggle = { collapsed: boolean; toggle: () => void };

function SubtaskToggleButton({ task, subtasks }: { task: TaskItem; subtasks: SubtaskToggle }) {
  const t = useT();
  return (
    <button
      type="button"
      className="sub-toggle"
      aria-label={t(subtasks.collapsed ? "Mostrar subtarefas de “{0}”" : "Recolher subtarefas de “{0}”", [task.title])}
      aria-expanded={!subtasks.collapsed}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        subtasks.toggle();
      }}
    >
      <IconChevronDown />
    </button>
  );
}

/** Toque prolongado sem mover abre o menu da tarefa (no celular o botão ⋯ fica oculto). */
function useLongPress(enabled: boolean, onLongPress: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!enabled) return {};
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch" || event.target instanceof Element && event.target.closest("input, textarea, [contenteditable=true]")) return;
      cancel();
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        start.current = null;
        swallowReleaseClick();
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const origin = start.current;
      if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
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
      { label: t("Adicionar tarefa acima"), icon: <IconInsertAbove />, onSelect: () => insert("above") },
      { label: t("Adicionar tarefa abaixo"), icon: <IconInsertBelow />, onSelect: () => insert("below") },
      "separator",
    );
  }
  if (active) {
    const dates = [
      { label: t("Hoje"), date: reference, icon: <IconCalendarDay day={dayOfMonth(reference)} />, className: "c-today" },
      { label: t("Amanhã"), date: addDays(reference, 1), icon: <IconSun />, className: "c-tomorrow" },
      { label: t("Fim de semana"), date: weekend(reference), icon: <IconSofa />, className: "c-weekend" },
      { label: t("Próxima semana"), date: nextWeek(reference), icon: <IconNextWeek />, className: "c-week" },
    ];
    items.push(
      { label: t("Editar"), icon: <IconEdit />, onSelect: edit },
      "separator",
      {
        kind: "choices",
        label: t("Data"),
        options: [
          ...dates.map((option) => ({
            label: `${option.label} · ${shortDate(option.date)}`, icon: option.icon, className: option.className,
            active: task.dueDate === option.date, onSelect: () => void actions.reschedule(task, option.date),
          })),
          ...(task.dueDate && !task.recurrence
            ? [{ label: t("Sem data"), icon: <IconBan />, onSelect: () => void actions.reschedule(task, null) }] : []),
          { label: t("Escolher data…"), icon: <IconMore />, popover: datePicker },
        ],
      },
      {
        kind: "choices",
        label: t("Prioridade"),
        options: ([1, 2, 3, 4] as Priority[]).map((priority) => ({
          label: t(PRIORITY_NAMES[priority]), icon: <IconFlag />, className: `mflag p${priority}`,
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
      { label: t("Mover para…"), icon: <IconMove />, onSelect: () => actions.openMove(task) },
      { label: t("Duplicar"), icon: <IconCopy />, onSelect: () => void actions.duplicate(task) },
    );
  } else {
    items.push({ label: t("Reabrir"), icon: <IconCheck />, onSelect: () => void actions.reopen(task) });
  }
  items.push("separator", { label: t("Excluir…"), icon: <IconTrash />, danger: true, onSelect: () => void actions.remove(task) });
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
  /** Seta para recolher ou mostrar as subtarefas (só na árvore do projeto). */
  subtasks?: SubtaskToggle;
  showMoreSubtasks?: boolean;
  extraClass?: string;
  noMenu?: boolean;
  timeOnly?: boolean;
  /** Toque prolongado abre o menu. Desligado nas linhas arrastáveis: lá o próprio arraste, solto sem mover, abre o menu. */
  longPressMenu?: boolean;
};

export const TaskRow = forwardRef<HTMLDivElement, RowProps>(function TaskRow({
  task, actions, showOrigin, grip, tag, arrange, onArrange, onKeyArrange, insert, variant = "row",
  depth = task.parentId && !showOrigin ? 1 : 0, subtasks, showMoreSubtasks, extraClass = "", noMenu, timeOnly, longPressMenu = true, style, onContextMenu, ...rest
}, ref) {
  const t = useT();
  const app = useApp();
  const mobile = useIsMobile();
  const temporary = isTemporaryTask(task.id);
  const contextMenu = useContextMenu(!noMenu && !temporary);
  const editing = useEditorOpen(editKey(task)) && !noMenu && !temporary;
  const [dateOpen, setDateOpen] = useState(false);
  const [acts, setActs] = useState<HTMLDivElement | null>(null);
  const longPress = useLongPress(longPressMenu && !noMenu && !temporary, contextMenu.open);
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
  const classes = [variant === "card" ? "card" : "task", sub ? "sub" : "", subtasks ? "has-sub" : "", subtasks?.collapsed ? "sub-collapsed" : "",
    task.status === "completed" ? "done-t" : "", extraClass]
    .filter(Boolean).join(" ");
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const handleContextMenu: MouseEventHandler<HTMLDivElement> = (event) => {
    // Durante um arraste por toque, o menu nativo do toque prolongado não abre o menu da tarefa.
    if (isDragActive()) {
      event.preventDefault();
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0 && selection.getRangeAt(0).intersectsNode(event.currentTarget)) {
      selection.removeAllRanges();
    }
    (onContextMenu ?? contextMenu.onContextMenu)?.(event);
  };
  return (
    <div ref={ref} className={classes} data-task-id={noMenu ? undefined : task.id} onKeyDown={onKeyArrange} style={{ ...indent, ...style }}
      onContextMenu={handleContextMenu} {...longPress} {...rest}>
      {grip && !temporary && variant === "row" && <span className="grip" aria-hidden="true"><IconGrip /></span>}
      {subtasks && <SubtaskToggleButton task={task} subtasks={subtasks} />}
      <Checkbox task={task} disabled={temporary} onToggle={() => actions.toggle(task)} />
      <TaskContent task={task} actions={actions} showOrigin={showOrigin} timeOnly={timeOnly} preview={noMenu} showMoreSubtasks={showMoreSubtasks} />
      {tag}
      {!noMenu && !temporary && (
        <div ref={setActs} className="t-acts" style={variant === "card" ? { margin: "-4px -6px 0 0" } : undefined}>
          {showShortcuts && (
            <>
              <button type="button" className="icon-btn desktop-only" aria-label={t("Editar “{0}”", [task.title])} data-tooltip={t("Editar")}
                onPointerDown={stop} onClick={(event) => { stop(event); edit(); }}>
                <IconEdit />
              </button>
              <button type="button" className="icon-btn desktop-only" aria-label={t("Agendar “{0}”", [task.title])} data-tooltip={t("Data")}
                aria-haspopup="dialog" aria-expanded={dateOpen}
                onPointerDown={stop} onClick={(event) => { stop(event); setDateOpen((value) => !value); }}>
                <IconCalendar />
              </button>
            </>
          )}
          <MenuButton className="icon-btn t-menu" label={t("Ações de “{0}”", [task.title])} title={task.title} contextMenu={contextMenu}
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
            <Popover anchor={acts} open={dateOpen} onClose={() => setDateOpen(false)} label={t("Agendar")} align="end">
              <DatePicker value={task.dueDate} reference={app.reference} onClose={() => setDateOpen(false)}
                allowClear={!task.recurrence} onPick={(date) => void actions.reschedule(task, date)} />
            </Popover>
          )}
        </div>
      )}
    </div>
  );
});

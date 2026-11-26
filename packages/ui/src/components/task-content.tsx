"use client";
import { TaskDescriptionExcerpt } from "./task-markdown";

import { useT } from "./language";

import { useCallback, useState, type ReactNode } from "react";
import { api } from "../client/api";
import { tagColor } from "../client/colors";
import { completedLabel, dayOfMonth, dueLabel, dueTone, FREQUENCY_LABEL } from "../client/dates";
import { inSentence } from "../client/locale";
import { editTask, isTemporaryTask } from "../client/task-mutations";
import { useQuery } from "../client/store";
import type { TaskDetail, TaskItem } from "@feito/core/types";
import { useApp } from "./app";
import { DueIcon, IconCheck, IconInbox, IconClock, IconFlag, IconRepeat, IconSub, IconTag } from "./icons";
import { ProjectGlyph } from "./project-style";
import { DatePicker, LabelPicker, PRIORITY_NAMES, PriorityMenu, RepeatMenu, TimePicker } from "./pickers";
import type { useTaskActions } from "./task-actions";
import { Popover, Spinner, useMediaQuery } from "./ui";

type Actions = ReturnType<typeof useTaskActions>;
const FIELD_LABELS = {
  date: "Data", time: "Horário", priority: "Prioridade", repeat: "Repetir",
  labels: "Etiquetas", subtasks: "Subtarefas",
};
type Field = keyof typeof FIELD_LABELS;
type OpenField = { key: string; field: Field; anchor: HTMLButtonElement };

export function TaskContent({ task, actions, showOrigin, timeOnly, preview, showDescription = true, showMoreSubtasks, onOpen }: {
  task: TaskItem; actions: Actions; showOrigin?: boolean; timeOnly?: boolean; preview?: boolean; showDescription?: boolean;
  showMoreSubtasks?: boolean; onOpen?: (id: string) => void;
}) {
  const t = useT();
  const app = useApp();
  const temporary = isTemporaryTask(task.id);
  const desktop = useMediaQuery("(min-width: 900px) and (any-pointer: fine)") && !preview && !temporary;
  const [openField, setOpenField] = useState<OpenField | null>(null);
  const close = useCallback(() => setOpenField((current) => current === openField ? null : current), [openField]);
  const active = task.status === "active";
  const editable = desktop && active;
  const { parentId, origin } = task;
  const destination = showOrigin && origin
    ? (origin.isInbox ? t("Entrada") : [origin.projectName, origin.sectionName].filter(Boolean).join(" / "))
    : null;

  const item = (key: string, content: ReactNode, options: {
    className?: string; label?: string; field?: Field; action?: () => void;
  } = {}) => {
    const { className, label, field, action } = options;
    if (!desktop || (!field && !action)) return <span key={key} className={className} aria-label={label}>{content}</span>;
    return (
      <button key={key} type="button" className={className} aria-label={label}
        aria-haspopup={field ? "dialog" : undefined}
        aria-expanded={field ? openField?.key === key : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (field) {
            const anchor = event.currentTarget;
            setOpenField((current) => current?.anchor === anchor ? null : { key, field, anchor });
          } else {
            action?.();
          }
        }}>
        {content}
      </button>
    );
  };

  const tone = task.dueDate ? dueTone(task.dueDate, app.reference, task.overdue) : "later";
  const dateClass = `m-date tone-${tone}`;
  const onlyTime = timeOnly && !task.overdue;
  const due = onlyTime ? task.dueTime : dueLabel(task.dueDate, editable ? null : task.dueTime, app.reference);
  const meta = (
    <span className={`t-meta p${task.priority}`}>
      {task.status === "completed" && task.completedAt
        ? item("done", completedLabel(task.completedAt, app.reference, app.timezone))
        : due && item("due", <>{onlyTime && editable ? <IconClock /> : <DueIcon tone={tone} day={dayOfMonth(task.dueDate ?? app.reference)} />}{due}
          {task.overdue && <span className="sr-only"> {" "}{t("(atrasada)")}</span>}</>, {
          className: dateClass,
          field: editable ? (onlyTime ? "time" : "date") : undefined,
          label: editable ? `${onlyTime ? t("Horário") : t("Data")}: ${due}${task.overdue ? t(" (atrasada)") : ""}` : undefined,
        })}
      {editable && !onlyTime && task.dueDate && task.dueTime && item("time", <><IconClock />{task.dueTime}</>, {
        className: dateClass, field: "time", label: t("Horário: {0}", [task.dueTime]),
      })}
      {task.recurrence && item("repeat", <><IconRepeat className="ic-repeat" />{t(FREQUENCY_LABEL[task.recurrence.frequency])}</>, {
        field: editable ? "repeat" : undefined, label: t("Repetir: {0}", [t(FREQUENCY_LABEL[task.recurrence.frequency])]),
      })}
      {parentId && origin?.parentTitle && item("parent", <><IconSub />{t("em")}{" "}{origin.parentTitle}</>, {
        label: desktop ? t("Tarefa-pai: {0}", [origin.parentTitle]) : undefined,
        action: () => app.openTask(parentId),
      })}
      {task.subtasks.total > 0 && (showMoreSubtasks ? item("subtasks", <><IconSub />{t("Ver subtarefas")}</>, {
        className: "m-task-details", action: () => app.openTask(task.id),
      }) : item("subtasks", <><IconSub />{task.subtasks.completed}/{task.subtasks.total}</>, {
        field: "subtasks", label: t("{0} de {1} subtarefas concluídas", [task.subtasks.completed, task.subtasks.total]),
      }))}
      {task.priority < 4 && item("priority", <><IconFlag />P{task.priority}</>, {
        className: "m-prio", field: editable ? "priority" : undefined,
        label: editable ? t(PRIORITY_NAMES[task.priority]) : undefined,
      })}
      {task.labels.map((label) => item(`label:${label.id}`, <><IconTag style={{ color: tagColor(label.id) }} />{label.name}</>, {
        field: editable ? "labels" : undefined, label: editable ? t("Etiqueta: {0}", [label.name]) : undefined,
      }))}
    </span>
  );

  // A origem fica na linha do título para que tarefas sem outros metadados ocupem uma linha só.
  const originContent = destination && origin && <>
    {origin.isInbox ? <IconInbox className="ic-inbox" /> : <ProjectGlyph id={task.projectId} />}
    {origin.isInbox || !origin.projectName ? <span className="t-origin-name">{destination}</span> : <>
      <span className="t-origin-name">{origin.projectName}</span>
      {origin.sectionName && <span className="t-origin-sec">/ {origin.sectionName}</span>}
    </>}
  </>;
  const originLabel = (originContent || undefined) && (editable
    ? <button type="button" className="t-origin" data-tooltip={destination ?? undefined}
      aria-label={t("Mover para… (atual: {0})", [destination])}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); actions.openMove(task); }}>
      {originContent}
    </button>
    : <span className="t-origin" data-tooltip={destination ?? undefined}>{originContent}</span>);

  const excerpt = showDescription ? task.descriptionExcerpt : null;
  const title = <span className="t-title">{task.title}</span>;
  return (
    <div className="t-body">
      {desktop ? (
        <div className="t-line">
          <button type="button" className="t-click" disabled={temporary} onClick={() => (onOpen ?? app.openTask)(task.id)}>
            {title}
            {excerpt && <TaskDescriptionExcerpt>{excerpt}</TaskDescriptionExcerpt>}
          </button>
          {originLabel}
        </div>
      ) : (
        <button type="button" className="t-click" disabled={temporary} onClick={() => (onOpen ?? app.openTask)(task.id)}>
          {originLabel ? <span className="t-line">{title}{originLabel}</span> : title}
          {excerpt && <TaskDescriptionExcerpt>{excerpt}</TaskDescriptionExcerpt>}
          {meta}
        </button>
      )}
      {desktop && meta}
      <Popover anchor={openField?.anchor ?? null} open={desktop && !!openField} onClose={close}
        label={openField ? t(FIELD_LABELS[openField.field]) : ""}>
        {openField && (
          <div onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <TaskFieldPicker key={openField.field} field={openField.field} task={task} actions={actions} close={close} />
          </div>
        )}
      </Popover>
    </div>
  );
}

function TaskFieldPicker({ field, task, actions, close }: {
  field: Field; task: TaskItem; actions: Actions; close: () => void;
}) {
  const t = useT();
  const app = useApp();
  switch (field) {
    case "date":
      return <DatePicker value={task.dueDate} reference={app.reference} onClose={close}
        allowClear={!task.recurrence} onPick={(date) => void actions.reschedule(task, date)} />;
    case "time":
      return <TimePicker value={task.dueTime} onPick={(time) => { close(); void actions.reschedule(task, task.dueDate, time); }} />;
    case "priority":
      return <PriorityMenu value={task.priority} onPick={(priority) => { close(); void actions.setPriority(task, priority); }} />;
    case "repeat":
      return <RepeatMenu value={task.recurrence?.frequency ?? null} onPick={(frequency) => {
        close();
        if (frequency === task.recurrence?.frequency) return;
        void app.run(() => editTask(app.taskContext, task, {
          recurrence: frequency ? { frequency, anchorDate: task.dueDate ?? app.reference, time: task.dueTime } : null,
        }),
        { success: frequency ? t("Repete: {0}", [inSentence(t(FREQUENCY_LABEL[frequency]))]) : t("Repetição removida") });
      }} />;
    case "labels":
      return <TaskLabels task={task} onSave={async (labelIds, revision) => {
        if (await app.run(() => editTask(app.taskContext, task, { labelIds }, revision))) close();
      }} />;
    case "subtasks":
      return <TaskSubtasks taskId={task.id} close={close} />;
  }
}

function TaskLabels({ task, onSave }: {
  task: TaskItem; onSave: (ids: string[], revision: number) => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState(() => ({ ids: task.labels.map((label) => label.id), revision: task.revision }));
  const [saving, setSaving] = useState(false);
  return (
    <fieldset className="task-field" disabled={saving}>
      <LabelPicker selected={draft.ids} onChange={(update) => setDraft((current) => ({ ...current, ids: update(current.ids) }))} />
      <button type="button" className="btn primary" onClick={async () => {
        setSaving(true);
        try { await onSave(draft.ids, draft.revision); } finally { setSaving(false); }
      }}>{t("Salvar")}</button>
    </fieldset>
  );
}

function TaskSubtasks({ taskId, close }: { taskId: string; close: () => void }) {
  const t = useT();
  const app = useApp();
  const query = useQuery<TaskDetail>(`task:${taskId}`, () => api.tasks.get(taskId));
  const task = query.data;
  if (!task) return query.error ? <p className="hint task-field">{t("Não foi possível carregar a tarefa.")}</p> : <Spinner />;

  return (
    <div className="menu">
      {task.children.map((child) => (
        <button type="button" key={child.id} className="mi" onClick={() => { close(); app.openTask(child.id); }}>
          {child.status === "completed" && <><IconCheck /><span className="sr-only">{t("Concluída:")}{" "}</span></>}
          <span>{child.title}</span>
        </button>
      ))}
      {!task.children.length && <p className="hint task-field">{t("Nenhuma subtarefa.")}</p>}
    </div>
  );
}

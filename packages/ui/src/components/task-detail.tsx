"use client";

import { useT } from "./language";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "../client/api";
import { tagColor } from "../client/colors";
import { dateInSentence, dateLabel, dayOfMonth, dueTone, FREQUENCY_LABEL } from "../client/dates";
import { inSentence } from "../client/locale";
import { useSidewaysScroll } from "../client/sideways-scroll";
import { useQuery } from "../client/store";
import { editTask } from "../client/task-mutations";
import type { EditTask, Frequency, Label, TaskDetail as Detail } from "@feito/core/types";
import { useApp, type TaskSelection } from "./app";
import {
  DueIcon, IconChevronDown, IconChevronUp, IconClock, IconCopy, IconExternal, IconFlag, IconInbox, IconLink,
  IconMore, IconPlus, IconRepeat, IconTag, IconTrash, IconX,
} from "./icons";
import { ProjectGlyph } from "./project-style";
import { DatePicker, LabelPicker, PRIORITY_NAMES, PriorityMenu, RepeatMenu, TimePicker } from "./pickers";
import { useTaskActions } from "./task-actions";
import { TaskContent } from "./task-content";
import { TaskDescription } from "./task-description";
import { Checkbox } from "./task-row";
import { Dialog, MenuButton, Popover, ReadFallback, useContextMenu, useToast } from "./ui";

type Pop = "date" | "time" | "repeat" | "priority" | "labels" | null;
type TextField = "title" | "description";
type TextDraft = { value: string; submitted?: boolean };
type TaskDraft = { taskId: string | null } & Partial<Record<TextField, TextDraft>>;

export function TaskDetailDialog({ selection, onClose }: { selection: TaskSelection | null; onClose: () => void }) {
  const t = useT();
  const taskId = selection?.id ?? null;
  const order = selection?.order ?? [];
  const index = taskId ? order.indexOf(taskId) : -1;
  const previousId = index > 0 ? order[index - 1] : undefined;
  const nextId = index >= 0 ? order[index + 1] : undefined;
  const app = useApp();
  const toast = useToast();
  const actions = useTaskActions();
  const taskKey = taskId ? `task:${taskId}` : null;
  const query = useQuery<Detail>(taskKey, () => api.tasks.get(taskId!));
  const task = query.data?.id === taskId ? query.data : undefined;
  const contextMenu = useContextMenu(!!task);
  const closeContextMenu = contextMenu.close;
  const labelsQuery = useQuery<{ labels: Label[] }>(taskId ? "labels" : null, api.labels.list);
  const [draft, setDraft] = useState<TaskDraft>({ taskId });
  if (draft.taskId !== taskId) setDraft({ taskId });
  const title = draft.title?.value ?? task?.title ?? "";
  const description = draft.description?.value ?? task?.description ?? "";
  const [pop, setPop] = useState<Pop>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const anchors = useRef<Record<string, HTMLButtonElement | null>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const titleField = useSidewaysScroll(titleRef);
  // O título também recebe foco sozinho; só um clique ou uma digitação contam como edição em andamento.
  const editingTitle = useRef(false);
  const focusTask = useRef<string | null>(null);
  const currentTaskId = useRef(taskId);
  currentTaskId.current = taskId;

  useEffect(() => closeContextMenu(), [taskId, closeContextMenu]);

  useEffect(() => {
    if (task && focusTask.current === task.id) {
      titleRef.current?.focus();
      focusTask.current = null;
    }
  }, [task]);

  useEffect(() => {
    if (query.error instanceof ApiFailure && query.error.code === "NOT_FOUND") {
      toast(t("A tarefa não existe mais."), { bad: true });
      onClose();
    }
  }, [query.error, onClose, toast, t]);

  const completed = task?.status === "completed";
  const project = task && (task.projectId === (app.nav?.inbox.projectId ?? app.me.inboxProjectId)
    ? { name: t("Entrada"), inbox: true }
    : { name: app.nav?.projects.find((item) => item.id === task.projectId)?.name ?? t("Projeto arquivado"), inbox: false });

  const save = (patch: Omit<EditTask, "revision">, success?: string) => task
    ? app.run(() => editTask(app.taskContext, task, patch), { success })
    : Promise.resolve();

  const changeLabels = (update: (current: string[]) => string[]) => {
    if (task) return app.run(() => editTask(app.taskContext, task, update));
  };

  const setRepeat = (frequency: Frequency | null) => {
    if (!task) return;
    setPop(null);
    return save({
      recurrence: frequency ? { frequency, anchorDate: task.dueDate ?? app.reference, time: task.dueTime } : null,
    }, frequency ? t("Repete: {0}", [inSentence(t(FREQUENCY_LABEL[frequency]))]) : t("Repetição removida"));
  };

  const updateText = (field: TextField, value: string) => {
    setDraft((current) => ({ ...current, [field]: { value } }));
  };

  const commitText = (field: TextField) => {
    const change = draft[field];
    if (!task || !change || change.submitted) return;
    const value = field === "title" ? change.value.trim() : change.value;
    if (field === "title" && !value) {
      setDraft((current) => ({ ...current, title: undefined }));
      return;
    }
    const submitted = { value, submitted: true };
    setDraft((current) => ({ ...current, [field]: submitted }));
    void save({ [field]: value }).finally(() => {
      setDraft((current) => current[field] === submitted ? { ...current, [field]: undefined } : current);
    });
  };

  const closePop = () => setPop(null);
  const anchorRef = (key: string) => (node: HTMLButtonElement | null) => { anchors.current[key] = node; };
  const recurrenceBlocked = !!task && (!!task.parentId || task.subtasks.total > 0);
  const openRelatedTask = (id: string, relatedOrder?: readonly string[]) => {
    focusTask.current = id;
    setPop(null);
    app.openTask(id, relatedOrder);
  };
  const taskLink = (id: string) => new URL(`/entrada?tarefa=${encodeURIComponent(id)}`, window.location.origin).href;
  const copyLink = async (id: string) => {
    const link = taskLink(id);
    try {
      await navigator.clipboard.writeText(link);
      toast(t("Link da tarefa copiado"));
    } catch {
      if (currentTaskId.current === id) setManualLink(link);
    }
  };

  return (
    <Dialog open={!!taskId} onClose={onClose} title={task?.title ?? t("Detalhe da tarefa")} wide hideHeader initialFocus={titleRef}>
      <div className="dialog-h task-detail-head" onContextMenu={contextMenu.onContextMenu}>
        <div className="crumb">
          {project?.inbox ? <IconInbox className="sm" /> : <ProjectGlyph id={task?.projectId} className="sm" />}
          <span>{project?.name}</span>
          {task?.parentId && task.origin?.parentTitle && (
            <>
              <span aria-hidden="true">/</span>
              <button type="button" className="task-parent-link" onClick={() => openRelatedTask(task.parentId!)}
                aria-label={t("Tarefa-pai: {0}", [task.origin.parentTitle])}>{task.origin.parentTitle}</button>
            </>
          )}
        </div>
        <div className="task-detail-tools">
          <button type="button" className="icon-btn" aria-label={t("Mostrar tarefa anterior")} data-tooltip={t("Mostrar tarefa anterior")}
            disabled={!previousId} onClick={() => previousId && openRelatedTask(previousId, order)}><IconChevronUp /></button>
          <button type="button" className="icon-btn" aria-label={t("Mostrar próxima tarefa")} data-tooltip={t("Mostrar próxima tarefa")}
            disabled={!nextId} onClick={() => nextId && openRelatedTask(nextId, order)}><IconChevronDown /></button>
          {task && <MenuButton key={task.id} label={t("Ações da tarefa")} contextMenu={contextMenu} items={() => [
            { label: t("Duplicar"), icon: <IconCopy />, onSelect: () => void actions.duplicate(task) },
            ...(app.browserTools ? [
              { label: t("Copiar link para a tarefa"), icon: <IconLink />, onSelect: () => void copyLink(task.id) },
              { label: t("Abrir em nova janela"), icon: <IconExternal />, onSelect: () => {
                window.open(taskLink(task.id), "_blank", "noopener,popup");
              } },
            ] : []),
            "separator",
            { label: t("Excluir"), icon: <IconTrash />, danger: true, onSelect: async () => {
              const removed = await actions.remove(task);
              if (removed && currentTaskId.current === task.id) onClose();
            } },
          ]}><IconMore /></MenuButton>}
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Fechar (Esc)")} data-autofocus><IconX /></button>
        </div>
      </div>
      {!task ? <ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} /> : (
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: "999 1 420px", minWidth: 0, padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            {completed && (
              <div className="banner warn">
                {t("Tarefa concluída. Reabra para editar ou mover.")}<button type="button" className="btn ghost" style={{ marginLeft: "auto", height: 30, color: "var(--brand-text)" }}
                  onClick={() => void actions.reopen(task)}>{t("Reabrir")}</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ marginTop: 2 }}>
                <Checkbox task={task} onToggle={() => actions.toggle(task)} />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <label htmlFor="detail-title" className="sr-only">{t("Título")}</label>
                <input id="detail-title" ref={titleField} className="title-input" value={title} readOnly={completed} maxLength={500}
                  onPointerDown={() => { editingTitle.current = true; }}
                  onChange={(event) => { editingTitle.current = true; updateText("title", event.target.value); }}
                  onBlur={(event) => {
                    // Trocar de janela dispara blur, mas o cursor continua no campo.
                    if (document.activeElement !== event.currentTarget) editingTitle.current = false;
                    commitText("title");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                    if (event.key !== "Escape" || !editingTitle.current || completed) return;
                    // Esc salva e sai do campo; o diálogo só fecha no Esc seguinte.
                    event.preventDefault();
                    event.stopPropagation();
                    if (!event.nativeEvent.isComposing) event.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
                  }} />
                <TaskDescription key={task.id} defaultPreview toolbar id="detail-desc" className="desc-input" value={description} readOnly={completed} rows={1}
                  placeholder={t("Descrição")} maxLength={10_000} style={{ color: description ? "var(--text)" : undefined }}
                  onValueChange={(value) => updateText("description", value)} onCommit={() => commitText("description")} />
              </div>
            </div>
            {(!completed || task.children.length > 0) && (
              <div style={{ marginLeft: 34, display: "flex", flexDirection: "column" }}>
                <div className="lbl" style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
                  {t("Subtarefas")}{" "}{task.subtasks.total > 0 && <span className="sub">{task.subtasks.completed}/{task.subtasks.total}</span>}
                </div>
                {task.children.map((child) => (
                  <div key={child.id} className={`task${child.status === "completed" ? " done-t" : ""}`} style={{ background: "transparent" }}>
                    <Checkbox task={child} onToggle={() => actions.toggle(child)} />
                    <TaskContent task={child} actions={actions} showDescription={false}
                      onOpen={(id) => openRelatedTask(id, task.children.map((item) => item.id))} />
                  </div>
                ))}
                {!completed && !task.recurrence && (
                  <button type="button" className="add-task" onClick={() => app.openQuickAdd({ parentId: task.id })}>
                    <span className="plus"><IconPlus /></span>{t("Adicionar subtarefa")}</button>
                )}
                <p className="hint" style={{ marginTop: 4 }}>
                  {task.recurrence ? t("Tarefas recorrentes não recebem subtarefas.")
                    : t("Subtarefas ficam no mesmo projeto e seção e têm data, prioridade e etiquetas próprias.")}
                </p>
              </div>
            )}
          </div>
          <aside className="d-side" aria-label={t("Detalhes da tarefa")}>
            <Section title={t("Projeto")}>
              <button type="button" className="d-val" disabled={completed} onClick={() => actions.openMove(task)}
                aria-label={t("Projeto: {0}. Mover para…", [project?.name ?? ""])}>
                {project?.inbox ? <IconInbox className="ic-inbox" /> : <ProjectGlyph id={task.projectId} />}
                <span className="d-text">{project?.name}{task.parentId && task.origin?.parentTitle ? ` / ${task.origin.parentTitle}` : ""}</span>
              </button>
            </Section>

            <Section title={t("Data")} add={!task.dueDate && !completed ? { ref: anchorRef("date"), label: t("Adicionar data"), expanded: pop === "date", onClick: () => setPop(pop === "date" ? null : "date") } : undefined}>
              {task.dueDate && (
                <>
                  <button type="button" ref={anchorRef("date")} className={`d-val tone-${dueTone(task.dueDate, app.reference, task.overdue)}`}
                    disabled={completed} aria-haspopup="dialog" onClick={() => setPop(pop === "date" ? null : "date")}>
                    <DueIcon tone={dueTone(task.dueDate, app.reference, task.overdue)} day={dayOfMonth(task.dueDate)} /><span className="d-text">{dateLabel(task.dueDate, app.reference)}</span>
                  </button>
                  <button type="button" ref={anchorRef("time")} className="d-val sub" disabled={completed} aria-haspopup="dialog"
                    aria-label={task.dueTime ? t("Hora: {0}", [task.dueTime]) : t("Adicionar horário")} onClick={() => setPop(pop === "time" ? null : "time")}>
                    <IconClock /><span className="d-text">{task.dueTime ?? t("Adicionar horário")}</span>
                  </button>
                </>
              )}
            </Section>

            <Section title={t("Repetir")} note={recurrenceBlocked ? t("Indisponível para subtarefas e para tarefas com subtarefas.") : undefined}
              add={!task.recurrenceRule && !completed && !recurrenceBlocked ? { ref: anchorRef("repeat"), label: t("Repetir: definir repetição"), expanded: pop === "repeat", onClick: () => setPop(pop === "repeat" ? null : "repeat") } : undefined}>
              {task.recurrenceRule && (
                <button type="button" ref={anchorRef("repeat")} className="d-val" disabled={completed} aria-haspopup="listbox"
                  onClick={() => setPop(pop === "repeat" ? null : "repeat")}>
                  <IconRepeat className="ic-repeat" /><span className="d-text">{t(FREQUENCY_LABEL[task.recurrenceRule.frequency])}</span>
                </button>
              )}
            </Section>

            <Section title={t("Prioridade")}>
              <button type="button" ref={anchorRef("priority")} className={`d-val p${task.priority}`} disabled={completed}
                aria-haspopup="listbox" aria-label={t("Prioridade: {0}", [t(PRIORITY_NAMES[task.priority])])}
                onClick={() => setPop(pop === "priority" ? null : "priority")}>
                <IconFlag style={{ color: "var(--pc)" }} /><span className="d-text">P{task.priority}</span>
              </button>
            </Section>

            <Section title={t("Etiquetas")} last
              add={!completed ? { ref: anchorRef("labels"), label: t("Etiquetas: adicionar etiqueta"), expanded: pop === "labels", onClick: () => setPop(pop === "labels" ? null : "labels") } : undefined}>
              {task.labels.length > 0 && (
                <div className="d-chips">
                  {task.labels.map((label) => (
                    <span key={label.id} className="pill">
                      <IconTag className="sm" style={{ color: tagColor(label.id) }} />{label.name}
                      {!completed && (
                        <button type="button" className="icon-btn" style={{ width: 20, height: 20, minHeight: 0 }} aria-label={t("Remover {0}", [label.name])}
                          onClick={() => void changeLabels((current) => current.filter((id) => id !== label.id))}>
                          <IconX className="sm" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          </aside>
        </div>
      )}
      {task && (
        <>
          <Popover anchor={anchors.current.date ?? null} open={pop === "date"} onClose={closePop} label={t("Data")}>
            <DatePicker value={task.dueDate} reference={app.reference} onClose={closePop} allowClear={!task.recurrence}
              onPick={(date) => void save({ dueDate: date }, date ? t("Agendada para {0}", [dateInSentence(dateLabel(date, app.reference))]) : t("Data removida"))} />
          </Popover>
          <Popover anchor={anchors.current.time ?? null} open={pop === "time"} onClose={closePop} label={t("Hora")}>
            <TimePicker value={task.dueTime} onPick={(time) => { void save({ dueTime: time }); closePop(); }} />
          </Popover>
          <Popover anchor={anchors.current.repeat ?? null} open={pop === "repeat"} onClose={closePop} label={t("Repetir")}>
            <RepeatMenu value={task.recurrenceRule?.frequency ?? null} onPick={(value) => void setRepeat(value)} />
          </Popover>
          <Popover anchor={anchors.current.priority ?? null} open={pop === "priority"} onClose={closePop} label={t("Prioridade")}>
            <PriorityMenu value={task.priority} onPick={(priority) => { closePop(); if (priority !== task.priority) void save({ priority }); }} />
          </Popover>
          <Popover anchor={anchors.current.labels ?? null} open={pop === "labels"} onClose={closePop} label={t("Etiquetas")}>
            <LabelPicker selected={task.labels.map((label) => label.id)} onChange={(update) => void changeLabels(update)} />
          </Popover>
        </>
      )}
      <Dialog open={!!task && !!manualLink} onClose={() => setManualLink(null)} title={t("Copiar link para a tarefa")}>
        <div className="dialog-b">
          <input className="input" aria-label={t("Link da tarefa")} value={manualLink ?? ""} readOnly data-autofocus
            onFocus={(event) => event.currentTarget.select()} />
        </div>
      </Dialog>
      {actions.moveDialog}
    </Dialog>
  );
}

type SectionAdd = {
  ref: (node: HTMLButtonElement | null) => void;
  label: string;
  expanded: boolean;
  onClick: () => void;
};

/** Bloco do painel lateral: título em cima, valor embaixo, + quando ainda não há valor. */
function Section({ title, add, note, last, children }: { title: string; add?: SectionAdd; note?: string; last?: boolean; children?: React.ReactNode }) {
  return (
    <section className={`d-sec${last ? " last" : ""}`} aria-label={title}>
      <h3 className="d-sec-h">
        {add ? (
          <button type="button" ref={add.ref} className="d-val" aria-label={add.label} aria-haspopup="dialog"
            aria-expanded={add.expanded} onClick={add.onClick}>
            {title}
            <IconPlus />
          </button>
        ) : title}
      </h3>
      {children}
      {note && <p className="hint">{note}</p>}
    </section>
  );
}

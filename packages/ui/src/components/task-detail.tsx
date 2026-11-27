"use client";

import { useT } from "./language";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  DueIcon, IconCalendar, IconChevronDown, IconChevronRight, IconChevronUp, IconClock, IconCopy, IconExternal, IconFlag, IconInbox, IconLink,
  IconMenu, IconMore, IconPlus, IconRepeat, IconTag, IconTrash, IconX,
} from "./icons";
import { ProjectGlyph } from "./project-style";
import { DatePicker, LabelPicker, PRIORITY_NAMES, PriorityMenu, RepeatMenu, TimePicker } from "./pickers";
import { useTaskActions } from "./task-actions";
import { CommentComposer, TaskComments } from "./task-comments";
import { TaskContent } from "./task-content";
import { TaskDescription } from "./task-description";
import { Checkbox } from "./task-row";
import { Collapse } from "./motion";
import { Dialog, MenuButton, Popover, ReadFallback, useContextMenu, useIsMobile, useToast } from "./ui";

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
  const mobile = useIsMobile();
  const [subtasksOpen, setSubtasksOpen] = useState(true);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const anchors = useRef<Record<string, HTMLButtonElement | null>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const titleField = useSidewaysScroll(titleRef);
  // No celular o título quebra linhas como no modelo de folha; Enter continua salvando.
  const titleArea = useRef<HTMLTextAreaElement>(null);
  // O título também recebe foco sozinho; só um clique ou uma digitação contam como edição em andamento.
  const editingTitle = useRef(false);
  const focusTask = useRef<string | null>(null);
  const currentTaskId = useRef(taskId);
  currentTaskId.current = taskId;

  useEffect(() => closeContextMenu(), [taskId, closeContextMenu]);

  useEffect(() => {
    if (task && focusTask.current === task.id) {
      (titleRef.current ?? titleArea.current)?.focus();
      focusTask.current = null;
    }
  }, [task]);

  useLayoutEffect(() => {
    const area = titleArea.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [title, mobile, task?.id]);

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

  const menu = task && <MenuButton key={task.id} label={t("Ações da tarefa")} contextMenu={contextMenu} items={() => [
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
  ]}><IconMore /></MenuButton>;

  const togglePop = (key: Exclude<Pop, null>) => setPop(pop === key ? null : key);

  type TitleElement = HTMLInputElement | HTMLTextAreaElement;
  const titleProps = {
    value: title, readOnly: completed, maxLength: 500,
    onPointerDown: () => { editingTitle.current = true; },
    onChange: (event: React.ChangeEvent<TitleElement>) => { editingTitle.current = true; updateText("title", event.target.value); },
    onBlur: (event: React.FocusEvent<TitleElement>) => {
      // Trocar de janela dispara blur, mas o cursor continua no campo.
      if (document.activeElement !== event.currentTarget) editingTitle.current = false;
      commitText("title");
    },
    onKeyDown: (event: React.KeyboardEvent<TitleElement>) => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key !== "Escape" || !editingTitle.current || completed) return;
      // Esc salva e sai do campo; o diálogo só fecha no Esc seguinte.
      event.preventDefault();
      event.stopPropagation();
      if (!event.nativeEvent.isComposing) event.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
    },
  };

  const titleInput = (
    <>
      <label htmlFor="detail-title" className="sr-only">{t("Título")}</label>
      {mobile
        ? <textarea id="detail-title" ref={titleArea} className="title-input md-title-input" rows={1} {...titleProps} />
        : <input id="detail-title" ref={titleField} className="title-input" {...titleProps} />}
    </>
  );

  const descriptionField = (current: Detail) => (
    <TaskDescription key={current.id} defaultPreview toolbar id="detail-desc" className="desc-input" value={description} readOnly={completed} rows={1}
      placeholder={t("Descrição")} maxLength={10_000} style={{ color: description ? "var(--text)" : undefined }}
      onValueChange={(value) => updateText("description", value)} onCommit={() => commitText("description")} />
  );

  const completedBanner = (current: Detail) => completed && (
    <div className="banner warn">
      {t("Tarefa concluída. Reabra para editar ou mover.")}<button type="button" className="btn ghost" style={{ marginLeft: "auto", height: 30, color: "var(--brand-text)" }}
        onClick={() => void actions.reopen(current)}>{t("Reabrir")}</button>
    </div>
  );

  const subtaskRows = (current: Detail) => (
    <>
      {current.children.map((child) => (
        <div key={child.id} className={`task${child.status === "completed" ? " done-t" : ""}`} style={{ background: "transparent" }}>
          <Checkbox task={child} onToggle={() => actions.toggle(child)} />
          <TaskContent task={child} actions={actions} showParent={false}
            onOpen={(id) => openRelatedTask(id, current.children.map((item) => item.id))} />
        </div>
      ))}
      {!completed && !current.recurrence && (
        <button type="button" className="add-task" onClick={() => app.openQuickAdd({ parentId: current.id })}>
          <span className="plus"><IconPlus /></span>{t("Adicionar subtarefa")}</button>
      )}
    </>
  );

  /** Celular: cartão com título, descrição, origem e data; demais campos numa faixa rolável; subtarefas abaixo. */
  const mobileBody = (current: Detail) => {
    const tone = current.dueDate ? dueTone(current.dueDate, app.reference, current.overdue) : null;
    const labelNames = current.labels.map((label) => label.name).join(", ");
    return (
      <div className="md-body">
        {completedBanner(current)}
        <div className="md-card">
          <div className="md-title">
            <Checkbox task={current} onToggle={() => actions.toggle(current)} />
            <div className="md-grow">{titleInput}</div>
          </div>
          <div className="md-row md-desc">
            <IconMenu className="md-ic" aria-hidden="true" />
            <div className="md-grow">{descriptionField(current)}</div>
          </div>
          <div className="md-row md-origin">
            <button type="button" className="md-link" disabled={completed} onClick={() => actions.openMove(current)}
              aria-label={t("Projeto: {0}. Mover para…", [project?.name ?? ""])}>
              {project?.inbox ? <IconInbox className="ic-inbox" /> : <ProjectGlyph id={current.projectId} />}
              <span className="d-text">{project?.name}</span>
            </button>
            {current.parentId && current.origin?.parentTitle && (
              <>
                <IconChevronRight className="md-sep" aria-hidden="true" />
                <button type="button" className="md-link md-parent" onClick={() => openRelatedTask(current.parentId!)}
                  aria-label={t("Tarefa-pai: {0}", [current.origin.parentTitle])}>
                  <span className="d-text">{current.origin.parentTitle}</span>
                </button>
              </>
            )}
          </div>
          <div className="md-row md-date">
            <button type="button" ref={anchorRef("date")} className={`md-link${tone ? ` tone-${tone}` : " md-placeholder"}`} disabled={completed}
              aria-haspopup="dialog" aria-expanded={pop === "date"} aria-label={current.dueDate ? undefined : t("Adicionar data")}
              onClick={() => togglePop("date")}>
              {current.dueDate && tone ? <DueIcon tone={tone} day={dayOfMonth(current.dueDate)} /> : <IconCalendar />}
              <span className="d-text">{current.dueDate ? dateLabel(current.dueDate, app.reference) : t("Data")}</span>
            </button>
            {current.dueDate && (
              <button type="button" ref={anchorRef("time")} className="md-link md-time" disabled={completed} aria-haspopup="dialog"
                aria-label={current.dueTime ? t("Hora: {0}", [current.dueTime]) : t("Adicionar horário")} onClick={() => togglePop("time")}>
                <IconClock /><span className="d-text">{current.dueTime ?? t("Hora")}</span>
              </button>
            )}
          </div>
          <div className="md-chips">
            <button type="button" ref={anchorRef("priority")} className={`pill p${current.priority}${current.priority < 4 ? " on" : ""}`} disabled={completed}
              aria-haspopup="listbox" aria-label={t("Prioridade: {0}", [t(PRIORITY_NAMES[current.priority])])} onClick={() => togglePop("priority")}>
              <IconFlag style={{ color: "var(--pc)" }} />{current.priority < 4 ? `P${current.priority}` : t("Prioridade")}
            </button>
            {(current.recurrenceRule || !recurrenceBlocked) && (
              <button type="button" ref={anchorRef("repeat")} className={`pill${current.recurrenceRule ? " on" : ""}`} disabled={completed}
                aria-haspopup="listbox" aria-label={current.recurrenceRule ? undefined : t("Repetir: definir repetição")} onClick={() => togglePop("repeat")}>
                <IconRepeat />{current.recurrenceRule ? t(FREQUENCY_LABEL[current.recurrenceRule.frequency]) : t("Repetir")}
              </button>
            )}
            <button type="button" ref={anchorRef("labels")} className={`pill${current.labels.length ? " on" : ""}`} disabled={completed}
              aria-haspopup="dialog" aria-expanded={pop === "labels"}
              aria-label={current.labels.length ? t("Etiquetas: {0}", [labelNames]) : t("Etiquetas: adicionar etiqueta")} onClick={() => togglePop("labels")}>
              {current.labels.length
                ? current.labels.map((label) => <IconTag key={label.id} style={{ color: tagColor(label.id) }} />)
                : <IconTag />}
              {current.labels.length ? labelNames : t("Etiquetas")}
            </button>
          </div>
        </div>
        {(!completed || current.children.length > 0) && (
          <section className="md-subs" aria-label={t("Subtarefas")}>
            <div className="md-subs-h">
              <h3>{t("Subtarefas")}</h3>
              {current.subtasks.total > 0 && <span className="sub">{current.subtasks.completed}/{current.subtasks.total}</span>}
              {current.children.length > 0 && (
                <button type="button" className="icon-btn" aria-expanded={subtasksOpen}
                  aria-label={subtasksOpen ? t("Recolher subtarefas de “{0}”", [current.title]) : t("Mostrar subtarefas de “{0}”", [current.title])}
                  onClick={() => setSubtasksOpen((value) => !value)}>
                  <IconChevronDown className={subtasksOpen ? undefined : "md-rot"} />
                </button>
              )}
            </div>
            <Collapse open={subtasksOpen || current.children.length === 0} appear={false}>
              <div className="md-card md-list">{subtaskRows(current)}</div>
            </Collapse>
            {current.recurrence && <p className="hint">{t("Tarefas recorrentes não recebem subtarefas.")}</p>}
          </section>
        )}
        <TaskComments key={`comments:${current.id}`} task={current} variant="mobile" />
        <CommentComposer key={`composer:${current.id}`} taskId={current.id} />
      </div>
    );
  };

  return (
    <Dialog open={!!taskId} onClose={onClose} title={task?.title ?? t("Detalhe da tarefa")} wide hideHeader expandable initialFocus={mobile ? titleArea : titleRef}>
      <div className="dialog-h task-detail-head" onContextMenu={contextMenu.onContextMenu}>
        <div className="crumb">
          {project?.inbox ? <IconInbox className="sm" /> : <ProjectGlyph id={task?.projectId} className="sm" />}
          <span>{project?.name}</span>
        </div>
        <div className="task-detail-tools">
          <button type="button" className="icon-btn" aria-label={t("Mostrar tarefa anterior")} data-tooltip={t("Mostrar tarefa anterior")}
            disabled={!previousId} onClick={() => previousId && openRelatedTask(previousId, order)}><IconChevronUp /></button>
          <button type="button" className="icon-btn" aria-label={t("Mostrar próxima tarefa")} data-tooltip={t("Mostrar próxima tarefa")}
            disabled={!nextId} onClick={() => nextId && openRelatedTask(nextId, order)}><IconChevronDown /></button>
          {menu}
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Fechar (Esc)")} data-autofocus><IconX /></button>
        </div>
      </div>
      {!task ? <ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} /> : mobile ? mobileBody(task) : (
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          <div className="td-main">
            {completedBanner(task)}
            {task.parentId && task.origin?.parentTitle && (
              <button type="button" className="td-parent" onClick={() => openRelatedTask(task.parentId!)}
                aria-label={t("Tarefa-pai: {0}", [task.origin.parentTitle])}>
                <span className="td-ring" aria-hidden="true" />
                <span className="d-text">{task.origin.parentTitle}</span>
                <IconChevronRight aria-hidden="true" />
              </button>
            )}
            <div className="td-title">
              <Checkbox task={task} onToggle={() => actions.toggle(task)} />
              <div className="md-grow">{titleInput}</div>
            </div>
            <div className="td-desc">
              {!description && <IconMenu className="md-ic" aria-hidden="true" />}
              <div className="md-grow">{descriptionField(task)}</div>
            </div>
            {task.children.length > 0 ? (
              <section className="td-subs" aria-label={t("Subtarefas")}>
                <button type="button" className="td-sec-h" aria-expanded={subtasksOpen} onClick={() => setSubtasksOpen((value) => !value)}
                  aria-label={subtasksOpen ? t("Recolher subtarefas de “{0}”", [task.title]) : t("Mostrar subtarefas de “{0}”", [task.title])}>
                  <IconChevronDown className={subtasksOpen ? undefined : "md-rot"} aria-hidden="true" />
                  <span className="td-sec-t">{t("Subtarefas")}</span>
                  <span className="sub">{task.subtasks.completed}/{task.subtasks.total}</span>
                </button>
                <Collapse open={subtasksOpen} appear={false}>
                  <div className="td-list">{subtaskRows(task)}</div>
                </Collapse>
              </section>
            ) : !completed && !task.recurrence && (
              <div className="td-list td-list-empty">{subtaskRows(task)}</div>
            )}
            {task.recurrence && <p className="hint td-hint">{t("Tarefas recorrentes não recebem subtarefas.")}</p>}
            <TaskComments key={task.id} task={task} variant="desktop" />
          </div>
          <aside className="d-side" aria-label={t("Detalhes da tarefa")}>
            <Section title={t("Projeto")}>
              <button type="button" className="d-val" disabled={completed} onClick={() => actions.openMove(task)}
                aria-label={t("Projeto: {0}. Mover para…", [project?.name ?? ""])}>
                {project?.inbox ? <IconInbox className="ic-inbox" /> : <ProjectGlyph id={task.projectId} />}
                <span className="d-text">{project?.name}</span>
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

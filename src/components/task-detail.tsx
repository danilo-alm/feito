"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, errorMessage } from "@/client/api";
import { dateLabel, FREQUENCY_LABEL } from "@/client/dates";
import { useQuery } from "@/client/store";
import type { EditTask, Frequency, Label, TaskDetail as Detail } from "@/client/types";
import { refreshAll, useApp } from "./app";
import {
  IconCalendar, IconClock, IconFlag, IconHash, IconInbox, IconMove, IconPlus, IconRepeat, IconTag, IconTrash, IconX,
} from "./icons";
import { LabelPicker, PRIORITY_NAMES, RepeatMenu } from "./pickers";
import { useTaskActions } from "./task-actions";
import { Checkbox, DatePicker, TaskMeta } from "./task-row";
import { Dialog, Popover, Spinner, useToast } from "./ui";

type Pop = "date" | "time" | "repeat" | "labels" | null;

export function TaskDetailDialog({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const app = useApp();
  const toast = useToast();
  const actions = useTaskActions();
  const query = useQuery<Detail>(taskId ? `task:${taskId}` : null, () => api.tasks.get(taskId!));
  const task = query.data?.id === taskId ? query.data : undefined;
  const labelsQuery = useQuery<{ labels: Label[] }>(taskId ? "labels" : null, api.labels.list);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pop, setPop] = useState<Pop>(null);
  const anchors = useRef<Record<string, HTMLButtonElement | null>>({});
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
    }
  }, [task]);

  useEffect(() => {
    if (query.error instanceof ApiFailure && query.error.code === "NOT_FOUND") {
      toast("A tarefa não existe mais.", { bad: true });
      onClose();
    }
  }, [query.error, onClose, toast]);

  const completed = task?.status === "completed";
  const project = task && (task.projectId === (app.nav?.inbox.projectId ?? app.me.inboxProjectId)
    ? { name: "Caixa de entrada", inbox: true }
    : { name: app.nav?.projects.find((item) => item.id === task.projectId)?.name ?? "Projeto arquivado", inbox: false });

  // Salvamentos em fila: cada edição usa a revisão devolvida pela anterior.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const revision = useRef<number | null>(null);
  useEffect(() => {
    if (task && (revision.current === null || task.revision > revision.current)) revision.current = task.revision;
  }, [task]);
  useEffect(() => {
    revision.current = null;
  }, [taskId]);

  const enqueue = (work: (current: number) => Promise<Detail>, success?: string) => {
    if (!task) return Promise.resolve();
    const run = async () => {
      try {
        const updated = await work(revision.current ?? task.revision);
        revision.current = updated.revision;
        query.mutate(() => updated);
        if (success) toast(success);
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "REVISION_CONFLICT") {
          toast("A tarefa mudou em outra aba. Recarreguei a versão atual.", { bad: true });
          revision.current = null;
          await query.reload();
        } else {
          toast(errorMessage(error), { bad: true });
        }
      } finally {
        void refreshAll();
      }
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  };

  const save = (patch: Omit<EditTask, "revision">, success?: string) =>
    enqueue((current) => api.tasks.edit(task!.id, { revision: current, ...patch }), success);

  const setRepeat = (frequency: Frequency | null) => {
    if (!task) return;
    setPop(null);
    return enqueue((current) => (frequency
      ? api.tasks.setRecurrence(task.id, { revision: current, frequency, anchorDate: task.dueDate ?? app.reference, time: task.dueTime })
      : api.tasks.clearRecurrence(task.id, current)),
    frequency ? `Repete: ${FREQUENCY_LABEL[frequency].toLowerCase()}` : "Repetição removida");
  };

  const commitTitle = () => {
    if (!task) return;
    const next = title.trim();
    if (!next) setTitle(task.title);
    else if (next !== task.title) void save({ title: next });
  };
  const commitDescription = () => {
    if (task && description !== task.description) void save({ description });
  };

  const closePop = () => setPop(null);
  const anchorRef = (key: string) => (node: HTMLButtonElement | null) => { anchors.current[key] = node; };
  const recurrenceBlocked = !!task && (!!task.parentId || task.subtasks.total > 0);

  return (
    <Dialog open={!!taskId} onClose={onClose} title={task?.title ?? "Detalhe da tarefa"} wide hideHeader initialFocus={titleRef}>
      <div className="dialog-h" style={{ padding: "8px 8px 8px 22px" }}>
        <span className="crumb" style={{ flex: 1, minWidth: 0 }}>
          {project?.inbox ? <IconInbox className="sm" /> : <IconHash className="sm" />}
          {project?.name}{task?.parentId && task.origin?.parentTitle ? ` / ${task.origin.parentTitle}` : ""}
        </span>
        {task && !completed && (
          <button type="button" className="btn ghost desktop-only" onClick={() => actions.openMove(task)}><IconMove />Mover para…</button>
        )}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar (Esc)"><IconX /></button>
      </div>
      {!task ? <Spinner /> : (
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: "999 1 420px", minWidth: 0, padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            {completed && (
              <div className="banner warn">
                Tarefa concluída. Reabra para editar ou mover.
                <button type="button" className="btn ghost" style={{ marginLeft: "auto", height: 30, color: "var(--brand-text)" }}
                  onClick={async () => { await actions.reopen(task); await query.reload(); }}>Reabrir</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ marginTop: 2 }}>
                <Checkbox task={task} onToggle={async () => { await actions.toggle(task); await query.reload(); }} />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <label htmlFor="detail-title" className="sr-only">Título</label>
                <input id="detail-title" ref={titleRef} className="title-input" value={title} readOnly={completed} maxLength={500}
                  onChange={(event) => setTitle(event.target.value)} onBlur={commitTitle}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
                <label htmlFor="detail-desc" className="sr-only">Descrição</label>
                <textarea id="detail-desc" className="desc-input" value={description} readOnly={completed} rows={3}
                  placeholder="Descrição" maxLength={10_000} style={{ color: description ? "var(--text)" : undefined }}
                  onChange={(event) => setDescription(event.target.value)} onBlur={commitDescription} />
              </div>
            </div>
            {!task.parentId && (
              <div style={{ marginLeft: 34, display: "flex", flexDirection: "column" }}>
                <div className="lbl" style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
                  Subtarefas {task.subtasks.total > 0 && <span className="sub">{task.subtasks.completed}/{task.subtasks.total}</span>}
                </div>
                {task.children.map((child) => (
                  <div key={child.id} className={`task${child.status === "completed" ? " done-t" : ""}`} style={{ background: "transparent" }}>
                    <Checkbox task={child} onToggle={async () => { await actions.toggle(child); await query.reload(); }} />
                    <button type="button" className="t-click" onClick={() => app.openTask(child.id)}>
                      <div className="t-body">
                        <div className="t-title">{child.title}</div>
                        <TaskMeta task={child} reference={app.reference} timezone={app.timezone} />
                      </div>
                    </button>
                  </div>
                ))}
                {!completed && !task.recurrence && (
                  <button type="button" className="add-task" onClick={() => app.openQuickAdd({ parentId: task.id })}>
                    <span className="plus"><IconPlus /></span>Adicionar subtarefa
                  </button>
                )}
                <p className="hint" style={{ marginTop: 4 }}>
                  {task.recurrence ? "Tarefas recorrentes não recebem subtarefas."
                    : "Subtarefas ficam no mesmo projeto e seção e têm data, prioridade e etiquetas próprias."}
                </p>
              </div>
            )}
          </div>
          <aside style={{ flex: "1 1 280px", background: "var(--sunken)", borderLeft: "1px solid var(--border)", padding: "12px 20px 20px", display: "flex", flexDirection: "column" }}>
            <div className="prop">
              <span className="k"><IconCalendar />Data</span>
              <div className="v">
                <button type="button" ref={anchorRef("date")} className="pill" disabled={completed} aria-haspopup="dialog"
                  onClick={() => setPop(pop === "date" ? null : "date")}
                  style={task.overdue ? { color: "var(--late)" } : undefined}>
                  {task.dueDate ? dateLabel(task.dueDate, app.reference) : "Sem data"}
                </button>
              </div>
            </div>
            <div className="prop">
              <span className="k"><IconClock />Hora</span>
              <div className="v">
                <button type="button" ref={anchorRef("time")} className="pill" disabled={completed || !task.dueDate}
                  aria-haspopup="dialog" onClick={() => setPop(pop === "time" ? null : "time")}
                  style={{ color: task.dueTime ? undefined : "var(--muted)" }}>
                  {task.dueTime ?? "Sem horário"}
                </button>
              </div>
            </div>
            <div className="prop">
              <span className="k"><IconRepeat />Repetir</span>
              <div className="v">
                <button type="button" ref={anchorRef("repeat")} className="pill" disabled={completed || recurrenceBlocked}
                  aria-haspopup="listbox" onClick={() => setPop(pop === "repeat" ? null : "repeat")}
                  style={{ color: task.recurrenceRule ? undefined : "var(--muted)" }}
                  title={recurrenceBlocked ? "Só tarefas sem subtarefas e que não são subtarefas podem repetir" : undefined}>
                  {task.recurrenceRule ? FREQUENCY_LABEL[task.recurrenceRule.frequency] : "Não repete"}
                </button>
              </div>
            </div>
            <div className="prop">
              <span className="k"><IconFlag />Prioridade</span>
              <div className="v" role="radiogroup" aria-label="Prioridade">
                {([1, 2, 3, 4] as const).map((priority) => (
                  <button key={priority} type="button" role="radio" aria-checked={task.priority === priority}
                    aria-label={PRIORITY_NAMES[priority]} disabled={completed}
                    className={`pill p${priority}${task.priority === priority ? " on" : ""}`}
                    onClick={() => task.priority !== priority && void save({ priority })}>
                    <IconFlag style={{ color: "var(--pc)" }} />P{priority}
                  </button>
                ))}
              </div>
            </div>
            <div className="prop" style={{ borderBottom: 0 }}>
              <span className="k"><IconTag />Etiquetas</span>
              <div className="v">
                {task.labels.map((label) => (
                  <span key={label.id} className="pill">
                    {label.name}
                    {!completed && (
                      <button type="button" className="icon-btn" style={{ width: 20, height: 20, minHeight: 0 }} aria-label={`Remover ${label.name}`}
                        onClick={() => void save({ labelIds: task.labels.filter((item) => item.id !== label.id).map((item) => item.id) })}>
                        <IconX className="sm" />
                      </button>
                    )}
                  </span>
                ))}
                {!completed && (
                  <button type="button" ref={anchorRef("labels")} className="icon-btn" style={{ width: 30, height: 30 }}
                    aria-label="Adicionar etiqueta" aria-haspopup="dialog" onClick={() => setPop(pop === "labels" ? null : "labels")}>
                    <IconPlus />
                  </button>
                )}
              </div>
            </div>
            <div style={{ marginTop: "auto", display: "flex", gap: 8, paddingTop: 18, flexWrap: "wrap" }}>
              {!completed && <button type="button" className="btn" onClick={() => actions.openMove(task)}><IconMove />Mover para…</button>}
              <button type="button" className="btn ghost danger"
                onClick={async () => { if (await actions.remove(task)) onClose(); }}><IconTrash />Excluir</button>
            </div>
          </aside>
        </div>
      )}
      {task && (
        <>
          <Popover anchor={anchors.current.date ?? null} open={pop === "date"} onClose={closePop} label="Data">
            <DatePicker value={task.dueDate} reference={app.reference} onClose={closePop} allowClear={!task.recurrence}
              onPick={(date) => void save({ dueDate: date }, date ? `Agendada para ${dateLabel(date, app.reference).toLowerCase()}` : "Data removida")} />
          </Popover>
          <Popover anchor={anchors.current.time ?? null} open={pop === "time"} onClose={closePop} label="Hora">
            <form className="date-pop" onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("time") as string;
              void save({ dueTime: value || null });
              closePop();
            }}>
              <label className="lbl" htmlFor="detail-time">Horário</label>
              <input id="detail-time" name="time" type="time" defaultValue={task.dueTime ?? ""} data-autofocus />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                {task.dueTime && <button type="button" className="btn ghost" onClick={() => { void save({ dueTime: null }); closePop(); }}>Sem horário</button>}
                <button type="submit" className="btn primary" style={{ marginLeft: "auto" }}>Salvar</button>
              </div>
            </form>
          </Popover>
          <Popover anchor={anchors.current.repeat ?? null} open={pop === "repeat"} onClose={closePop} label="Repetir">
            <RepeatMenu value={task.recurrenceRule?.frequency ?? null} onPick={(value) => void setRepeat(value)} />
          </Popover>
          <Popover anchor={anchors.current.labels ?? null} open={pop === "labels"} onClose={() => { closePop(); void labelsQuery.reload(); }} label="Etiquetas">
            <LabelPicker selected={task.labels.map((label) => label.id)} onChange={(ids) => void save({ labelIds: ids })} />
          </Popover>
        </>
      )}
      {actions.moveDialog}
    </Dialog>
  );
}

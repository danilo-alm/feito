"use client";

import { getLocale } from "../client/locale";
import { useT } from "./language";

import { useCallback, useMemo, useState } from "react";
import { api, ApiFailure } from "../client/api";
import { dateInSentence, dateLabel } from "../client/dates";
import { useQuery } from "../client/store";
import { completeTask, duplicateTask, editTask, removeTask, reopenTask, undoTask } from "../client/task-mutations";
import type { Priority, ProjectPage, TaskItem } from "@feito/core/types";
import { useApp } from "./app";
import { IconCheck, IconInbox, IconSearch } from "./icons";
import { ProjectGlyph } from "./project-style";
import { Collapse } from "./motion";
import { Dialog, useToast } from "./ui";

export function useTaskActions() {
  const t = useT();
  const app = useApp();
  const toast = useToast();
  const [moving, setMoving] = useState<TaskItem | null>(null);

  const complete = useCallback(async (task: TaskItem) => {
    const attempt = (includeChildren?: boolean) => completeTask(app.taskContext, task, includeChildren);
    await app.run(async () => {
      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.code !== "HAS_ACTIVE_CHILDREN") throw error;
        const count = Number(error.details?.activeChildCount ?? 0);
        const ok = await app.confirm({
          title: t("Concluir também as subtarefas?"),
          body: t("“{0}” tem {1} {2}. Elas serão concluídas juntas.", [task.title, count, count === 1 ? t("subtarefa aberta") : t("subtarefas abertas")]),
          confirmLabel: t("Concluir tudo"),
        });
        if (!ok) return undefined;
        return await attempt(true);
      }
    }, {
      success: (result) => {
        if (!result) return "";
        const message = result.previous.recurrence && result.task.status === "active" && result.task.dueDate
          ? t("Concluída · próxima em {0}", [dateInSentence(dateLabel(result.task.dueDate, app.reference))])
          : result.completedChildIds.length
            ? t("Concluída com {0} subtarefa(s)", [result.completedChildIds.length])
            : t("Concluída");
        if (result.alreadyProcessed) return message;
        return {
          message,
          action: {
            label: t("Desfazer"),
            onClick: () => {
              void app.run(() => undoTask(app.taskContext, result.previous, {
                revision: result.task.revision,
                occurrenceId: result.previous.occurrenceId ?? undefined,
                completedChildIds: result.completedChildIds,
              }), { success: t("Conclusão desfeita") });
            },
          },
        };
      },
    });
  }, [app, t]);

  const reopen = useCallback(async (task: TaskItem) => {
    await app.run(() => reopenTask(app.taskContext, task), {
      success: (result) => (result.reopenedParentId ? t("Tarefa e tarefas-pai reabertas") : t("Tarefa reaberta")),
    });
  }, [app, t]);

  const toggle = useCallback((task: TaskItem) => (task.status === "completed" ? reopen(task) : complete(task)), [complete, reopen]);

  const remove = useCallback(async (task: TaskItem) => {
    const children = task.subtasks.total;
    const ok = await app.confirm({
      title: t("Excluir “{0}”?", [task.title]),
      body: children
        ? t("Também apaga todas as subtarefas desta tarefa, em todos os níveis. Não dá para desfazer.")
        : t("A exclusão é permanente e não dá para desfazer."),
      confirmLabel: t("Excluir"),
      danger: true,
    });
    if (!ok) return false;
    const done = await app.run(() => removeTask(app.taskContext, task).then(() => true), { success: t("Tarefa excluída") });
    return !!done;
  }, [app, t]);

  const reschedule = useCallback(async (task: TaskItem, dueDate: string | null, dueTime?: string | null) => {
    if (task.recurrence && dueDate === null) {
      toast(t("Para tirar a data de uma recorrente, remova a repetição no detalhe."), { bad: true });
      return;
    }
    await app.run(() => editTask(app.taskContext, task, {
      dueDate, ...(dueTime !== undefined ? { dueTime } : {}),
    }), { success: dueDate ? t("Agendada para {0}", [dateInSentence(dateLabel(dueDate, app.reference))]) : t("Data removida") });
  }, [app, toast, t]);

  const setPriority = useCallback(async (task: TaskItem, priority: Priority) => {
    if (priority === task.priority) return;
    await app.run(() => editTask(app.taskContext, task, { priority }), {
      success: priority < 4 ? t("Prioridade {0}", [priority]) : t("Prioridade removida"),
    });
  }, [app, t]);

  /** Cria uma cópia (sem subtarefas) logo abaixo da original. */
  const duplicate = useCallback(async (task: TaskItem) => {
    await app.run(() => duplicateTask(app.taskContext, task), { success: t("Tarefa duplicada") });
  }, [app, t]);

  const openMove = useCallback((task: TaskItem) => setMoving(task), []);
  const moveDialog = <MoveDialog task={moving} onClose={() => setMoving(null)} />;

  return { complete, reopen, toggle, remove, reschedule, setPriority, duplicate, openMove, moveDialog };
}

function MoveDialog({ task, onClose }: { task: TaskItem | null; onClose: () => void }) {
  const t = useT();
  const app = useApp();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const projects = useMemo(() => {
    if (!app.nav) return [];
    const inbox = { id: app.nav.inbox.projectId, name: t("Caixa de entrada"), isInbox: true, defaultSectionName: null };
    return [inbox, ...app.nav.projects];
  }, [app.nav, t]);
  const sections = useQuery<ProjectPage>(expanded ? `project:${expanded}` : null, () => api.projects.get(expanded!));
  const needle = filter.trim().toLocaleLowerCase(getLocale());

  const choose = async (projectId: string, sectionId: string | null, label: string) => {
    if (!task || busy) return;
    if (task.projectId === projectId && task.sectionId === sectionId && !task.parentId) {
      onClose();
      return;
    }
    setBusy(true);
    const saved = await app.run(() => editTask(app.taskContext, task, { destination: { projectId, sectionId } }), {
      success: t("Movida para {0}", [label]),
    });
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <Dialog open={!!task} onClose={onClose} title={t("Mover para…")}>
      <div className="dialog-b" style={{ gap: 10 }}>
        <div style={{ position: "relative" }}>
          <IconSearch style={{ position: "absolute", left: 12, top: 13, color: "var(--muted)" }} />
          <label htmlFor="move-filter" className="sr-only">{t("Buscar projeto")}</label>
          <input id="move-filter" className="input" placeholder={t("Projeto ou seção")} style={{ paddingLeft: 40 }}
            value={filter} onChange={(event) => setFilter(event.target.value)} data-autofocus />
        </div>
        <div className="menu" style={{ padding: 0 }} role="listbox" aria-label={t("Destinos")}>
          {projects.filter((project) => !needle || project.name.toLocaleLowerCase(getLocale()).includes(needle)).map((project) => {
            const open = expanded === project.id;
            const current = task?.projectId === project.id;
            const defaultSectionName = project.defaultSectionName ?? t("Sem seção");
            return (
              <div key={project.id}>
                <button type="button" className="mi" role="option" aria-selected={current && task?.sectionId === null}
                  aria-expanded={project.isInbox ? undefined : open}
                  onClick={() => (project.isInbox ? choose(project.id, null, project.name) : setExpanded(open ? null : project.id))}>
                  {project.isInbox ? <IconInbox /> : <ProjectGlyph id={project.id} />}
                  <span style={{ flex: 1 }}>{project.name}</span>
                  {current && <span className="sub">{t("atual")}</span>}
                </button>
                <Collapse open={open}>
                  <div>
                    <button type="button" className="mi" role="option" style={{ paddingLeft: 36 }} aria-selected={false}
                      onClick={() => choose(project.id, null, `${project.name} · ${defaultSectionName}`)}>
                      <span style={{ flex: 1 }}>{defaultSectionName}</span>
                      {current && task?.sectionId === null && <IconCheck />}
                    </button>
                    {sections.data?.project.id === project.id && sections.data.sections.map((section) => (
                      <button key={section.id} type="button" className="mi" role="option" style={{ paddingLeft: 36 }}
                        aria-selected={task?.sectionId === section.id}
                        onClick={() => choose(project.id, section.id, section.name)}>
                        <span style={{ flex: 1 }}>{section.name}</span>
                        {task?.sectionId === section.id && <span className="sub">{t("atual")}</span>}
                      </button>
                    ))}
                    {sections.loading && !sections.data && <div className="hint" style={{ padding: "6px 36px" }}>{t("Carregando seções…")}</div>}
                  </div>
                </Collapse>
              </div>
            );
          })}
        </div>
        <p className="hint">
          {t("Projetos arquivados não aparecem. Subtarefas vão junto.")}{task?.parentId ? " Esta subtarefa vira tarefa principal no destino." : ""}
        </p>
      </div>
    </Dialog>
  );
}

"use client";
import { useCallback, useMemo, useState } from "react";
import { api, ApiFailure } from "@/client/api";
import { dateLabel } from "@/client/dates";
import { useQuery } from "@/client/store";
import { completeTask, duplicateTask, editTask, removeTask, reopenTask, undoTask } from "@/client/task-mutations";
import type { Priority, ProjectPage, TaskItem } from "@/client/types";
import { useApp } from "./app";
import { IconCheck, IconInbox, IconSearch } from "./icons";
import { ProjectGlyph } from "./project-style";
import { Collapse } from "./motion";
import { Dialog, useToast } from "./ui";

export function useTaskActions() {
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
          title: "Concluir também as subtarefas?",
          body: `“${task.title}” tem ${count} ${count === 1 ? "subtarefa aberta" : "subtarefas abertas"}. Elas serão concluídas juntas.`,
          confirmLabel: "Concluir tudo",
        });
        if (!ok) return undefined;
        return await attempt(true);
      }
    }, {
      success: (result) => {
        if (!result) return "";
        const message = result.previous.recurrence && result.task.status === "active" && result.task.dueDate
          ? `Concluída · próxima em ${dateLabel(result.task.dueDate, app.reference).toLowerCase()}`
          : result.completedChildIds.length
            ? `Concluída com ${result.completedChildIds.length} subtarefa(s)`
            : "Concluída";
        if (result.alreadyProcessed) return message;
        return {
          message,
          action: {
            label: "Desfazer",
            onClick: () => {
              void app.run(() => undoTask(app.taskContext, result.previous, {
                revision: result.task.revision,
                occurrenceId: result.previous.occurrenceId ?? undefined,
                completedChildIds: result.completedChildIds,
              }), { success: "Conclusão desfeita" });
            },
          },
        };
      },
    });
  }, [app]);

  const reopen = useCallback(async (task: TaskItem) => {
    await app.run(() => reopenTask(app.taskContext, task), {
      success: (result) => (result.reopenedParentId ? "Tarefa e tarefas-pai reabertas" : "Tarefa reaberta"),
    });
  }, [app]);

  const toggle = useCallback((task: TaskItem) => (task.status === "completed" ? reopen(task) : complete(task)), [complete, reopen]);

  const remove = useCallback(async (task: TaskItem) => {
    const children = task.subtasks.total;
    const ok = await app.confirm({
      title: `Excluir “${task.title}”?`,
      body: children
        ? "Também apaga todas as subtarefas desta tarefa, em todos os níveis. Não dá para desfazer."
        : "A exclusão é permanente e não dá para desfazer.",
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return false;
    const done = await app.run(() => removeTask(app.taskContext, task).then(() => true), { success: "Tarefa excluída" });
    return !!done;
  }, [app]);

  const reschedule = useCallback(async (task: TaskItem, dueDate: string | null, dueTime?: string | null) => {
    if (task.recurrence && dueDate === null) {
      toast("Para tirar a data de uma recorrente, remova a repetição no detalhe.", { bad: true });
      return;
    }
    await app.run(() => editTask(app.taskContext, task, {
      dueDate, ...(dueTime !== undefined ? { dueTime } : {}),
    }), { success: dueDate ? `Agendada para ${dateLabel(dueDate, app.reference).toLowerCase()}` : "Data removida" });
  }, [app, toast]);

  const setPriority = useCallback(async (task: TaskItem, priority: Priority) => {
    if (priority === task.priority) return;
    await app.run(() => editTask(app.taskContext, task, { priority }), {
      success: priority < 4 ? `Prioridade ${priority}` : "Prioridade removida",
    });
  }, [app]);

  /** Cria uma cópia (sem subtarefas) logo abaixo da original. */
  const duplicate = useCallback(async (task: TaskItem) => {
    await app.run(() => duplicateTask(app.taskContext, task), { success: "Tarefa duplicada" });
  }, [app]);

  const openMove = useCallback((task: TaskItem) => setMoving(task), []);
  const moveDialog = <MoveDialog task={moving} onClose={() => setMoving(null)} />;

  return { complete, reopen, toggle, remove, reschedule, setPriority, duplicate, openMove, moveDialog };
}

function MoveDialog({ task, onClose }: { task: TaskItem | null; onClose: () => void }) {
  const app = useApp();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const projects = useMemo(() => {
    if (!app.nav) return [];
    const inbox = { id: app.nav.inbox.projectId, name: "Caixa de entrada", isInbox: true, defaultSectionName: null };
    return [inbox, ...app.nav.projects];
  }, [app.nav]);
  const sections = useQuery<ProjectPage>(expanded ? `project:${expanded}` : null, () => api.projects.get(expanded!));
  const needle = filter.trim().toLocaleLowerCase("pt-BR");

  const choose = async (projectId: string, sectionId: string | null, label: string) => {
    if (!task || busy) return;
    if (task.projectId === projectId && task.sectionId === sectionId && !task.parentId) {
      onClose();
      return;
    }
    setBusy(true);
    const saved = await app.run(() => editTask(app.taskContext, task, { destination: { projectId, sectionId } }), {
      success: `Movida para ${label}`,
    });
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <Dialog open={!!task} onClose={onClose} title="Mover para…">
      <div className="dialog-b" style={{ gap: 10 }}>
        <div style={{ position: "relative" }}>
          <IconSearch style={{ position: "absolute", left: 12, top: 13, color: "var(--muted)" }} />
          <label htmlFor="move-filter" className="sr-only">Buscar projeto</label>
          <input id="move-filter" className="input" placeholder="Projeto ou seção" style={{ paddingLeft: 40 }}
            value={filter} onChange={(event) => setFilter(event.target.value)} data-autofocus />
        </div>
        <div className="menu" style={{ padding: 0 }} role="listbox" aria-label="Destinos">
          {projects.filter((project) => !needle || project.name.toLocaleLowerCase("pt-BR").includes(needle)).map((project) => {
            const open = expanded === project.id;
            const current = task?.projectId === project.id;
            const defaultSectionName = project.defaultSectionName ?? "Sem seção";
            return (
              <div key={project.id}>
                <button type="button" className="mi" role="option" aria-selected={current && task?.sectionId === null}
                  aria-expanded={project.isInbox ? undefined : open}
                  onClick={() => (project.isInbox ? choose(project.id, null, project.name) : setExpanded(open ? null : project.id))}>
                  {project.isInbox ? <IconInbox /> : <ProjectGlyph id={project.id} />}
                  <span style={{ flex: 1 }}>{project.name}</span>
                  {current && <span className="sub">atual</span>}
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
                        {task?.sectionId === section.id && <span className="sub">atual</span>}
                      </button>
                    ))}
                    {sections.loading && !sections.data && <div className="hint" style={{ padding: "6px 36px" }}>Carregando seções…</div>}
                  </div>
                </Collapse>
              </div>
            );
          })}
        </div>
        <p className="hint">
          Projetos arquivados não aparecem. Subtarefas vão junto.
          {task?.parentId ? " Esta subtarefa vira tarefa principal no destino." : ""}
        </p>
      </div>
    </Dialog>
  );
}

"use client";
import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { api, ApiFailure } from "@/client/api";
import { tagColor } from "@/client/colors";
import { completedLabel, dayOfMonth, dueLabel, dueTone, FREQUENCY_LABEL } from "@/client/dates";
import { useQuery } from "@/client/store";
import { maxOverviewDepth, taskBranch } from "@/client/tree";
import type { PublicProjectPage, PublicTask } from "@/client/types";
import { PageTaskCount } from "./chrome";
import { DueIcon, IconCheck, IconEye, IconFlag, IconRepeat, IconSub, IconTag, Logo } from "./icons";
import { Dialog, Spinner } from "./ui";

/** Página de leitura de um projeto compartilhado por link: sem sessão e sem controles de edição. */
export function PublicProjectView({ token }: { token: string }) {
  // undefined: o servidor usa project.view.showCompleted; depois vale a escolha do visitante (não é salva).
  const [includeCompleted, setIncludeCompleted] = useState<boolean | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useQuery<PublicProjectPage>(`public:${token}:${includeCompleted ?? "default"}`,
    () => api.publicProject(token, includeCompleted));
  // Mantém a página anterior na tela enquanto a outra variante carrega.
  const [last, setLast] = useState<PublicProjectPage | undefined>(undefined);
  if (query.data && query.data !== last) setLast(query.data);
  const page = query.data ?? last;

  const missing = query.error instanceof ApiFailure && query.error.code === "NOT_FOUND";
  if (missing || (query.error && !page)) {
    return (
      <PublicFrame>
        <div className="public-missing">
          <h1>{missing ? "Link indisponível" : "Não foi possível abrir o projeto"}</h1>
          <p>{missing
            ? "Este link de projeto foi desativado ou não existe. Peça um link novo a quem compartilhou."
            : "Verifique a conexão e tente de novo."}</p>
          {!missing && <button type="button" className="btn" onClick={() => void query.reload()}>Tentar de novo</button>}
        </div>
      </PublicFrame>
    );
  }
  if (!page) return <PublicFrame><Spinner /></PublicFrame>;

  const tasks = new Map(page.tasks.map((task) => [task.id, task]));
  const showCompleted = includeCompleted ?? page.project.view.showCompleted;
  const board = page.project.view.layout === "board";
  const open = openId ? tasks.get(openId) ?? null : null;
  const props: LayoutProps = { page, tasks, onOpen: setOpenId };

  return (
    <PublicFrame>
      <div className="project-head" style={{ padding: "4px 32px 0" }}>
        <div className={board ? "" : "col"}>
          <div className="page-h">
            <h1 className="title">{page.project.name}</h1>
            <div className="page-meta">
              <PageTaskCount count={page.project.activeCount} />
              <div className="public-tools">
                <span id="public-completed">Mostrar concluídas</span>
                <button type="button" className={`switch${showCompleted ? " on" : ""}`} role="switch" aria-checked={showCompleted}
                  aria-labelledby="public-completed" onClick={() => setIncludeCompleted(!showCompleted)} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {board ? <PublicBoard {...props} /> : <PublicList {...props} />}
      <Dialog open={!!open} onClose={() => setOpenId(null)} title={open?.title ?? ""}>
        {open && <PublicTaskDetail task={open} tasks={tasks} reference={page.referenceDate} onOpen={setOpenId} />}
      </Dialog>
    </PublicFrame>
  );
}

function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="public">
      <header className="public-top">
        <Link href="/" className="brand"><Logo />Feito</Link>
        <span className="public-tag"><IconEye />Projeto compartilhado · só leitura</span>
      </header>
      <main id="conteudo">{children}</main>
    </div>
  );
}

type LayoutProps = { page: PublicProjectPage; tasks: Map<string, PublicTask>; onOpen: (id: string) => void };

function sectionTitle(page: PublicProjectPage, sectionId: string | null) {
  return sectionId === null ? "Sem seção" : page.sections.find((section) => section.id === sectionId)?.name ?? "Seção";
}

function roots(page: PublicProjectPage, tasks: Map<string, PublicTask>, sectionId: string | null) {
  const list = (page.groups.find((group) => group.sectionId === sectionId)?.rootIds ?? [])
    .map((id) => tasks.get(id)).filter((task): task is PublicTask => !!task);
  return { active: list.filter((task) => task.status === "active"), done: list.filter((task) => task.status === "completed") };
}

function PublicList({ page, tasks, onOpen }: LayoutProps) {
  const block = (root: PublicTask) => Array.from(taskBranch(root, tasks, maxOverviewDepth), ({ task, depth }) => (
    <PublicTaskRow key={task.id} task={task} depth={depth} reference={page.referenceDate} onOpen={onOpen} />
  ));
  return (
    <div className="content">
      <div className="col">
        {page.groups.map((group) => {
          const { active, done } = roots(page, tasks, group.sectionId);
          if (group.sectionId === null && !active.length && !done.length) return null;
          return (
            <section key={group.sectionId ?? "none"} className="list-group" aria-label={sectionTitle(page, group.sectionId)}>
              <div className="sec-h" style={{ color: group.sectionId === null ? "var(--muted)" : undefined }}>
                {sectionTitle(page, group.sectionId)}<span className="count">{active.length}</span>
              </div>
              {active.flatMap(block)}
              {done.length > 0 && (
                <>
                  <div className="sec-h" style={{ color: "var(--muted)", fontSize: 13, paddingTop: 12 }}>Concluídas<span className="count">{done.length}</span></div>
                  {done.flatMap(block)}
                </>
              )}
            </section>
          );
        })}
        {page.tasks.length === 0 && (
          <div className="empty"><strong>Nenhuma tarefa por aqui</strong>Este projeto ainda não tem tarefas visíveis.</div>
        )}
      </div>
    </div>
  );
}

function PublicBoard({ page, tasks, onOpen }: LayoutProps) {
  const block = (root: PublicTask) => Array.from(taskBranch(root, tasks, maxOverviewDepth), ({ task, depth }) => (
    <PublicTaskRow key={task.id} task={task} depth={depth} reference={page.referenceDate} onOpen={onOpen} card />
  ));
  const columns = page.groups.filter((group) => group.sectionId !== null || group.rootIds.length > 0 || page.sections.length === 0);
  return (
    <div className="board">
      {columns.map((group) => {
        const { active, done } = roots(page, tasks, group.sectionId);
        const title = sectionTitle(page, group.sectionId);
        return (
          <section key={group.sectionId ?? "none"} className="column" aria-label={`Coluna ${title}`}>
            <div className="col-h" style={{ color: group.sectionId === null ? "var(--muted)" : undefined }}>
              {title}<span className="count">{active.length}</span>
            </div>
            {active.flatMap(block)}
            {done.length > 0 && (
              <>
                <div className="sub" style={{ padding: "10px 6px 6px", fontWeight: 600 }}>Concluídas · {done.length}</div>
                {done.flatMap(block)}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Ring({ task }: { task: PublicTask }) {
  const done = task.status === "completed";
  return (
    <span className={`chk p${task.priority}${done ? " done" : ""}`} aria-hidden="true">
      <span className="ring"><IconCheck /></span>
    </span>
  );
}

function PublicMeta({ task, reference, showMoreSubtasks }: { task: PublicTask; reference: string; showMoreSubtasks?: boolean }) {
  const due = dueLabel(task.dueDate, task.dueTime, reference);
  return (
    <span className={`t-meta p${task.priority}`}>
      {task.status === "completed" && task.completedAt
        ? <span>{completedLabel(task.completedAt, reference)}</span>
        : due && (
          <span className={`m-date tone-${dueTone(task.dueDate!, reference, task.overdue)}`}>
            <DueIcon tone={dueTone(task.dueDate!, reference, task.overdue)} day={dayOfMonth(task.dueDate!)} />{due}{task.overdue && <span className="sr-only"> (atrasada)</span>}
          </span>
        )}
      {task.recurrence && <span><IconRepeat />{FREQUENCY_LABEL[task.recurrence.frequency]}</span>}
      {showMoreSubtasks ? <span className="m-task-details"><IconSub />Ver subtarefas</span> : task.subtasks.total > 0 && (
        <span aria-label={`${task.subtasks.completed} de ${task.subtasks.total} subtarefas concluídas`}>
          <IconSub />{task.subtasks.completed}/{task.subtasks.total}
        </span>
      )}
      {task.priority < 4 && <span className="m-prio"><IconFlag />P{task.priority}</span>}
      {task.labels.map((label) => <span key={label.id}><IconTag style={{ color: tagColor(label.id) }} />{label.name}</span>)}
    </span>
  );
}

function PublicTaskRow({ task, depth, reference, onOpen, card }: {
  task: PublicTask; depth: number; reference: string; onOpen: (id: string) => void; card?: boolean;
}) {
  const classes = [card ? "card" : "task", depth > 0 ? "sub" : "", task.status === "completed" ? "done-t" : ""]
    .filter(Boolean).join(" ");
  return (
    <div className={classes} style={{ "--task-depth": depth } as CSSProperties}>
      <Ring task={task} />
      <div className="t-body">
        <button type="button" className="t-click" onClick={() => onOpen(task.id)}>
          <span className="t-title">{task.title}</span>
          {task.descriptionExcerpt && <span className="t-desc">{task.descriptionExcerpt}</span>}
          <PublicMeta task={task} reference={reference} showMoreSubtasks={depth === maxOverviewDepth && task.childIds.length > 0} />
        </button>
      </div>
    </div>
  );
}

function PublicTaskDetail({ task, tasks, reference, onOpen }: {
  task: PublicTask; tasks: Map<string, PublicTask>; reference: string; onOpen: (id: string) => void;
}) {
  const parent = task.parentId ? tasks.get(task.parentId) : undefined;
  const children = task.childIds.map((id) => tasks.get(id)).filter((child): child is PublicTask => !!child);
  return (
    <div className="dialog-b">
      {parent && (
        <button type="button" className="btn ghost" style={{ alignSelf: "flex-start", height: 30, padding: "0 8px", marginLeft: -8 }}
          onClick={() => onOpen(parent.id)}>
          <IconSub />em {parent.title}
        </button>
      )}
      <div className="public-meta"><PublicMeta task={task} reference={reference} /></div>
      {task.description
        ? <p className="public-desc">{task.description}</p>
        : <p className="hint">Sem descrição.</p>}
      {children.length > 0 && (
        <div>
          <div className="lbl" style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Subtarefas</div>
          <ul className="public-sub">
            {children.map((child) => (
              <li key={child.id} className={child.status === "completed" ? "done" : undefined}>
                <Ring task={child} />
                <button type="button" className="t-click" onClick={() => onOpen(child.id)}>
                  {child.status === "completed" && <span className="sr-only">Concluída: </span>}
                  <span>{child.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

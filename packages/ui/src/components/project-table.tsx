"use client";

import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Priority, ProjectPage, TaskItem } from "@feito/core/types";
import { tagColor } from "../client/colors";
import { dueLabel, dueTone } from "../client/dates";
import type { InsertDefaults } from "../client/editor-store";
import { getLocale } from "../client/locale";
import { maxOverviewDepth, sectionName, unnamedColumnTitle } from "../client/tree";
import { useApp } from "./app";
import { IconArrowUp, IconCalendar, IconCheck, IconFlag, IconPlus, IconRepeat, IconSub, IconTable, IconTag } from "./icons";
import { useT } from "./language";
import { DatePicker, PriorityMenu } from "./pickers";
import { useTaskActions } from "./task-actions";
import { AddTaskSlot } from "./task-editor";
import { Checkbox } from "./task-row";
import { Popover } from "./ui";

type Actions = ReturnType<typeof useTaskActions>;
export type TableColumn = "date" | "priority" | "labels" | "subtasks" | "description";
export type TableSort = { key: "title" | "date" | "priority"; dir: "asc" | "desc" } | null;

export const TABLE_COLUMNS: { key: TableColumn; label: string }[] = [
  { key: "date", label: "Data" },
  { key: "priority", label: "Prioridade" },
  { key: "labels", label: "Etiquetas" },
  { key: "subtasks", label: "Subtarefas" },
  { key: "description", label: "Descrição" },
];
const DEFAULT_COLUMNS: TableColumn[] = ["date", "priority", "labels", "subtasks"];
const COLUMNS_KEY = "feito:table-columns";
const PRIORITY_LABEL: Record<Priority, string> = { 1: "P1", 2: "P2", 3: "P3", 4: "P4" };

/** As colunas são uma preferência de exibição do aparelho; sem armazenamento, valem as padrão. */
function storedColumns(): TableColumn[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null") as unknown;
    if (!Array.isArray(saved)) return DEFAULT_COLUMNS;
    return TABLE_COLUMNS.map(({ key }) => key).filter((key) => saved.includes(key));
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function storeColumns(columns: TableColumn[]) {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns));
  } catch {
    // Sem armazenamento local, a escolha vale só nesta visita.
  }
}

/** Ordena irmãs pela coluna escolhida; sem ordenação, mantém a ordem da resposta (manual, data ou prioridade). */
export function sortSiblings(tasks: TaskItem[], sort: TableSort) {
  if (!sort) return tasks;
  const factor = sort.dir === "asc" ? 1 : -1;
  const compare = (a: TaskItem, b: TaskItem) => {
    if (sort.key === "title") return a.title.localeCompare(b.title, getLocale(), { sensitivity: "base" });
    if (sort.key === "priority") return a.priority - b.priority;
    // Sem data vai para o fim nos dois sentidos.
    if (!a.dueDate || !b.dueDate) return a.dueDate ? -factor : b.dueDate ? factor : 0;
    const left = `${a.dueDate} ${a.dueTime ?? "99:99"}`;
    const right = `${b.dueDate} ${b.dueTime ?? "99:99"}`;
    return left < right ? -1 : left > right ? 1 : 0;
  };
  return [...tasks].sort((a, b) => factor * compare(a, b));
}

/** Linhas de um grupo: cada tarefa seguida das subtarefas, até a profundidade exibida nas outras visões. */
export function tableRows(roots: TaskItem[], tasks: Map<string, TaskItem>, sort: TableSort) {
  const rows: { task: TaskItem; depth: number }[] = [];
  const walk = (list: TaskItem[], depth: number) => {
    for (const task of sortSiblings(list, sort)) {
      rows.push({ task, depth });
      if (depth < maxOverviewDepth) {
        walk(task.childIds.map((id) => tasks.get(id)).filter((child): child is TaskItem => !!child), depth + 1);
      }
    }
  };
  walk(roots, 0);
  return rows;
}

type Editing = { taskId: string; field: "date" | "priority"; anchor: HTMLElement } | null;

/** Grupo de linhas da tabela: uma seção de projeto ou um dia de agenda. */
export type TableGroup = { key: string; title?: string; roots: TaskItem[]; add?: { slot: string; defaults: InsertDefaults } };

export function TableLayout({ page, actions, archived }: { page: ProjectPage; actions: Actions; archived: boolean }) {
  const t = useT();
  const { project } = page;
  const tasks = new Map(page.tasks.map((task) => [task.id, task]));
  const showGroupHeaders = !project.isInbox && (page.sections.length > 0 || !!project.defaultSectionName);
  const groups = page.groups.flatMap((group): TableGroup[] => {
    const roots = group.rootIds.map((id) => tasks.get(id)).filter((task): task is TaskItem => !!task);
    if (showGroupHeaders && group.sectionId === null && !project.defaultSectionName && !roots.length) return [];
    const name = group.sectionId === null ? project.defaultSectionName : sectionName(page, group.sectionId);
    return [{
      key: group.sectionId ?? "none", title: showGroupHeaders ? name ?? t(unnamedColumnTitle) : undefined, roots,
      add: { slot: `add:${project.id}:${group.sectionId ?? "none"}`, defaults: { projectId: project.id, sectionId: group.sectionId } },
    }];
  });
  return (
    <TaskTable groups={groups} tasks={page.tasks} actions={actions} archived={archived} label={t("Tarefas do projeto")}
      empty={page.tasks.length === 0 && (
        <div className="empty">
          <strong>{project.isInbox ? t("Entrada vazia") : t("Nenhuma tarefa ainda")}</strong>
          {project.isInbox ? t("Capture qualquer coisa com Q ou com o botão +.") : t("Adicione tarefas e organize em seções.")}
        </div>
      )} />
  );
}

/** Tabela de tarefas em grupos, com colunas configuráveis e edição de data e prioridade na própria célula. */
export function TaskTable({ groups, tasks: list, actions, archived, label, empty, flat = false }: {
  groups: TableGroup[]; tasks: TaskItem[]; actions: Actions; archived: boolean; label: string; empty?: ReactNode;
  /** Agendas: cada tarefa é uma linha, sem repetir subtarefas que também aparecem no grupo. */
  flat?: boolean;
}) {
  const t = useT();
  const app = useApp();
  const [columns, setColumnsState] = useState<TableColumn[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState<TableSort>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [columnsAnchor, setColumnsAnchor] = useState<HTMLButtonElement | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  useEffect(() => setColumnsState(storedColumns()), []);

  const tasks = new Map(list.map((task) => [task.id, task]));
  const rowsOf = (roots: TaskItem[]) => flat
    ? sortSiblings(roots, sort).map((task) => ({ task, depth: 0 })) : tableRows(roots, tasks, sort);
  const editingTask = editing ? tasks.get(editing.taskId) : undefined;
  const show = (column: TableColumn) => columns.includes(column);
  const span = columns.length + 1;
  const setColumns = (next: TableColumn[]) => {
    setColumnsState(next);
    storeColumns(next);
  };
  const toggleColumn = (column: TableColumn) =>
    setColumns(TABLE_COLUMNS.map(({ key }) => key).filter((key) => key === column ? !show(key) : show(key)));
  const cycleSort = (key: NonNullable<TableSort>["key"]) => setSort((current) =>
    current?.key !== key ? { key, dir: "asc" } : current.dir === "asc" ? { key, dir: "desc" } : null);
  const ariaSort = (key: NonNullable<TableSort>["key"]) => sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const header = (key: NonNullable<TableSort>["key"], label: string) => (
    <th scope="col" aria-sort={ariaSort(key)}>
      <button type="button" className={`ptable-sort${sort?.key === key ? " on" : ""}`} onClick={() => cycleSort(key)}>
        {/* Uma seta só, que gira entre crescente e decrescente. */}
        {label}{sort?.key === key && <IconArrowUp className={`ptable-arrow${sort.dir === "desc" ? " desc" : ""}`} />}
      </button>
    </th>
  );

  const row = ({ task, depth }: { task: TaskItem; depth: number }) => {
    const tone = task.dueDate ? dueTone(task.dueDate, app.reference, task.overdue) : null;
    const done = task.status === "completed";
    const locked = archived || done;
    return (
      <tr key={task.id} className={`ptable-row${done ? " done-t" : ""}`} data-task-id={task.id}>
        <td>
          <div className="ptable-task" style={{ "--task-depth": depth } as CSSProperties}>
            <Checkbox task={task} disabled={archived} onToggle={() => actions.toggle(task)} />
            <button type="button" className="ptable-title t-click" onClick={() => app.openTask(task.id)}>{task.title}</button>
            {task.recurrence && <IconRepeat className="sm" label={t("Recorrente")} style={{ color: "var(--muted)" }} />}
          </div>
        </td>
        {show("date") && (
          <td>
            <button type="button" className={`ptable-cell m-date${tone ? ` tone-${tone}` : ""}`} disabled={locked}
              aria-haspopup="dialog" aria-label={t("Data de “{0}”: {1}", [task.title, dueLabel(task.dueDate, task.dueTime, app.reference) ?? t("Sem data")])}
              onClick={(event) => setEditing({ taskId: task.id, field: "date", anchor: event.currentTarget })}>
              {/* A chave troca com o valor: o novo entra com a transição de `.ptable-val`. */}
              <span key={`${task.dueDate}:${task.dueTime}`} className="ptable-val">
                {task.dueDate ? <><IconCalendar />{dueLabel(task.dueDate, task.dueTime, app.reference)}</> : <span className="ptable-empty">{t("Sem data")}</span>}
              </span>
            </button>
          </td>
        )}
        {show("priority") && (
          <td>
            <button type="button" className={`ptable-cell p${task.priority}`} disabled={locked} aria-haspopup="listbox"
              aria-label={t("Prioridade de “{0}”: {1}", [task.title, PRIORITY_LABEL[task.priority]])}
              onClick={(event) => setEditing({ taskId: task.id, field: "priority", anchor: event.currentTarget })}>
              <span key={task.priority} className="ptable-val"><IconFlag style={{ color: "var(--pc)" }} />{PRIORITY_LABEL[task.priority]}</span>
            </button>
          </td>
        )}
        {show("labels") && (
          <td>
            {task.labels.length
              ? <span className="ptable-labels">{task.labels.map((label) => (
                <span key={label.id} className="ptable-label"><IconTag style={{ color: tagColor(label.id) }} />{label.name}</span>
              ))}</span>
              : <span className="ptable-empty" aria-label={t("Sem etiquetas")}>—</span>}
          </td>
        )}
        {show("subtasks") && (
          <td>
            {task.subtasks.total
              ? <span className="ptable-subs"><IconSub />{task.subtasks.completed}/{task.subtasks.total}</span>
              : <span className="ptable-empty" aria-label={t("Sem subtarefas")}>—</span>}
          </td>
        )}
        {show("description") && (
          <td><span className="ptable-desc">{task.descriptionExcerpt ?? ""}</span></td>
        )}
      </tr>
    );
  };

  return (
    <div className="content ptable">
      <div className="ptable-bar">
        <button ref={setColumnsAnchor} type="button" className={`btn${columnsOpen ? " on" : ""}`} aria-haspopup="dialog" aria-expanded={columnsOpen}
          onClick={() => setColumnsOpen((open) => !open)}><IconTable />{t("Colunas")}</button>
      </div>
      <Popover anchor={columnsAnchor} open={columnsOpen} onClose={() => setColumnsOpen(false)} label={t("Colunas da tabela")} align="end" width={240}>
        <div className="menu" role="group" aria-label={t("Colunas da tabela")}>
          <div className="mi" aria-disabled="true" style={{ color: "var(--muted)" }}>
            <span style={{ flex: 1 }}>{t("Tarefa")}</span><IconCheck />
          </div>
          {TABLE_COLUMNS.map(({ key, label }) => (
            <button key={key} type="button" role="menuitemcheckbox" aria-checked={show(key)} className="mi" onClick={() => toggleColumn(key)}>
              <span style={{ flex: 1 }}>{t(label)}</span>{show(key) && <IconCheck />}
            </button>
          ))}
        </div>
      </Popover>
      <div className="ptable-scroll">
        <table className="ptable-grid" aria-label={label}>
          <thead>
            <tr>
              {header("title", t("Tarefa"))}
              {show("date") && header("date", t("Data"))}
              {show("priority") && header("priority", t("Prioridade"))}
              {show("labels") && <th scope="col">{t("Etiquetas")}</th>}
              {show("subtasks") && <th scope="col">{t("Subtarefas")}</th>}
              {show("description") && <th scope="col">{t("Descrição")}</th>}
            </tr>
          </thead>
          {groups.map((group) => {
            const active = group.roots.filter((task) => task.status === "active");
            const done = group.roots.filter((task) => task.status === "completed");
            return (
              <tbody key={group.key} aria-label={group.title}>
                {group.title !== undefined && (
                  <tr className="ptable-group">
                    <th scope="colgroup" colSpan={span}>{group.title}<span className="count">{active.length}</span></th>
                  </tr>
                )}
                {rowsOf(active).map(row)}
                {!archived && group.add && (
                  <tr className="ptable-add">
                    <td colSpan={span}>
                      <AddTaskSlot slot={group.add.slot} defaults={group.add.defaults}>
                        {(start) => (
                          <button type="button" className="add-task" onClick={start}><span className="plus"><IconPlus /></span>{t("Adicionar tarefa")}</button>
                        )}
                      </AddTaskSlot>
                    </td>
                  </tr>
                )}
                {done.length > 0 && (
                  <Fragment>
                    <tr className="ptable-group ptable-done-h">
                      <th scope="colgroup" colSpan={span}>{t("Concluídas")}<span className="count">{done.length}</span></th>
                    </tr>
                    {rowsOf(done).map(row)}
                  </Fragment>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
      {empty}
      <Popover anchor={editing?.anchor ?? null} open={!!editing && !!editingTask} onClose={() => setEditing(null)}
        label={editing?.field === "priority" ? t("Prioridade") : t("Agendar")}>
        {editing && editingTask && (editing.field === "date"
          ? <DatePicker value={editingTask.dueDate} reference={app.reference} onClose={() => setEditing(null)} allowClear={!editingTask.recurrence}
            onPick={(date) => void actions.reschedule(editingTask, date)} />
          : <PriorityMenu value={editingTask.priority} onPick={(priority) => {
            setEditing(null);
            void actions.setPriority(editingTask, priority);
          }} />)}
      </Popover>
    </div>
  );
}

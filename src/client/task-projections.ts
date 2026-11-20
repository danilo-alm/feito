import { inboxName } from "@/domain/product";
import { compareSearchKey, normalizeSearchText } from "@/domain/search";
import type { QueryData } from "./store";
import type {
  Label, LabelTasks, MoveResponse, Navigation, ProjectPage, SearchInput, SearchResult, TaskChanges,
  TaskDetail, TaskItem, TaskState, TodayView, UpcomingView,
} from "./types";

export function taskStates(data: QueryData) {
  const tasks = new Map<string, TaskState>();
  const add = (items: TaskState[]) => {
    for (const item of items) {
      const previous = tasks.get(item.id);
      if (previous && previous.revision > item.revision) continue;
      tasks.set(item.id, {
        ...previous,
        ...item,
        childIds: item.childIds.length >= (previous?.childIds.length ?? 0) || previous?.revision !== item.revision
          ? item.childIds : previous.childIds,
      });
    }
  };
  for (const [key, value] of data) {
    if (!value) continue;
    if (key.startsWith("project:")) add((value as ProjectPage).tasks);
    else if (key.startsWith("today:")) {
      const today = value as TodayView;
      add([...today.overdue, ...today.today, ...(today.completedToday ?? [])]);
    } else if (key.startsWith("upcoming:")) {
      for (const day of (value as UpcomingView).days) add(day.tasks);
    } else if (key.startsWith("label:")) add((value as LabelTasks).tasks);
    else if (key.startsWith("search:")) add((value as SearchResult).results);
  }
  for (const [key, value] of data) {
    if (!value || !key.startsWith("task:")) continue;
    const detail = value as TaskDetail;
    add([detail, ...detail.children]);
  }
  return tasks;
}

export function taskOrigin(data: QueryData, tasks: Map<string, TaskState>, task: TaskState): TaskItem["origin"] {
  const nav = data.get("nav") as Navigation | undefined;
  const page = data.get(`project:${task.projectId}`) as ProjectPage | undefined;
  const project = page?.project ?? nav?.projects.find((item) => item.id === task.projectId);
  const isInbox = project?.isInbox ?? (nav?.inbox.projectId === task.projectId || task.origin?.isInbox || false);
  return {
    projectName: project?.name ?? (isInbox ? inboxName : task.origin?.projectName ?? "Projeto"),
    isInbox,
    sectionName: task.sectionId
      ? page?.sections.find((section) => section.id === task.sectionId)?.name ?? task.origin?.sectionName ?? null
      : null,
    parentTitle: task.parentId ? tasks.get(task.parentId)?.title ?? task.origin?.parentTitle ?? null : null,
  };
}

function visible(data: QueryData, task: TaskState) {
  return (data.get(`project:${task.projectId}`) as ProjectPage | undefined)?.project.status !== "archived";
}

const active = (task: TaskState) => task.status === "active";
const entryId = ({ before, after }: TaskChanges["rows"][number]) => (after ?? before)!.id;
const byId = (a: TaskItem, b: TaskItem) => a.id.localeCompare(b.id);
const byTime = (a: TaskItem, b: TaskItem) => (a.dueTime ?? "24:00").localeCompare(b.dueTime ?? "24:00");
const agendaOrder = (a: TaskItem, b: TaskItem) => byTime(a, b) || a.priority - b.priority || byId(a, b);
const overdueOrder = (a: TaskItem, b: TaskItem) => a.dueDate!.localeCompare(b.dueDate!) || agendaOrder(a, b);
const completedOrder = (a: TaskItem, b: TaskItem) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!) || byId(a, b);

function membershipDelta(rows: TaskChanges["rows"], includes: (task: TaskState) => boolean) {
  return rows.reduce((sum, { before, after }) =>
    sum + Number(!!after && includes(after)) - Number(!!before && includes(before)), 0);
}

function ordered(ids: string[], preferred: string[]) {
  const remaining = new Set(ids);
  return [...preferred.filter((id) => remaining.delete(id)), ...remaining];
}

function updateList(
  tasks: TaskItem[], rows: TaskChanges["rows"], includes: (task: TaskState) => boolean,
  sort?: (a: TaskItem, b: TaskItem) => number,
) {
  const existing = new Map(tasks.map((task) => [task.id, task]));
  let changed = false;
  for (const row of rows) {
    const id = entryId(row);
    const next = row.after;
    const current = existing.get(id);
    if (current && next && current.revision > next.revision) continue;
    if (next && includes(next)) {
      existing.set(id, next);
      changed = true;
    } else {
      changed = existing.delete(id) || changed;
    }
  }
  if (!changed) return tasks;
  const list = [...existing.values()];
  return sort ? list.sort(sort) : list;
}

function patchProject(page: ProjectPage, rows: TaskChanges["rows"], groups: NonNullable<TaskChanges["groups"]>) {
  const id = page.project.id;
  const affected = rows.filter(({ before, after }) => before?.projectId === id || after?.projectId === id);
  if (!affected.length && !groups.some((group) => group.projectId === id)) return page;

  const { showCompleted, sortMode } = page.project.view;
  const items = updateList(page.tasks, affected, (task) => task.projectId === id && (showCompleted || active(task)));
  const byTask = new Map(items.map((task) => [task.id, task]));
  const roots = new Map<string | null, TaskItem[]>();
  const children = new Map<string, string[]>();
  for (const task of items) {
    if (task.parentId) {
      const list = children.get(task.parentId) ?? [];
      list.push(task.id);
      children.set(task.parentId, list);
    } else {
      const list = roots.get(task.sectionId) ?? [];
      list.push(task);
      roots.set(task.sectionId, list);
    }
  }
  const groupFor = (sectionId: string | null, parentId: string | null) =>
    groups.find((group) => group.projectId === id && group.sectionId === sectionId && group.parentId === parentId);
  const count = (sectionId: string) => membershipDelta(affected, (task) => task.projectId === id && task.sectionId === sectionId);
  return {
    ...page,
    project: page.project.status === "archived" ? page.project : {
      ...page.project,
      activeCount: Math.max(0, page.project.activeCount + membershipDelta(affected, (task) => task.projectId === id && active(task))),
    },
    sections: page.sections.map((section) => {
      const delta = count(section.id);
      return delta ? { ...section, taskCount: Math.max(0, section.taskCount + delta) } : section;
    }),
    tasks: items.map((task) => {
      const preferred = groupFor(task.sectionId, task.id)?.orderedIds ?? task.childIds;
      const childIds = ordered(children.get(task.id) ?? [], preferred);
      return childIds.length === task.childIds.length && childIds.every((child, index) => child === task.childIds[index])
        ? task : { ...task, childIds };
    }),
    groups: page.groups.map((group) => {
      const preferred = groupFor(group.sectionId, null)?.orderedIds ?? group.rootIds;
      const ids = ordered((roots.get(group.sectionId) ?? []).map((task) => task.id), preferred);
      if (sortMode !== "manual") {
        ids.sort((left, right) => {
          const a = byTask.get(left)!;
          const b = byTask.get(right)!;
          if (sortMode === "priority") return a.priority - b.priority;
          return (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99") || byTime(a, b);
        });
      }
      return { ...group, rootIds: ids };
    }),
  };
}

function patchDetail(detail: TaskDetail, rows: TaskChanges["rows"], groups: MoveResponse["groups"]) {
  const own = rows.find((row) => entryId(row) === detail.id);
  if (own && !own.after) return undefined;
  const next = own?.after && own.after.revision >= detail.revision ? own.after : detail;
  const children = updateList(detail.children, rows, (task) => task.parentId === detail.id);
  const group = groups.find(({ parentId, projectId }) => parentId === detail.id && projectId === next.projectId);
  if (next === detail && children === detail.children && !group) return detail;
  const byTask = new Map(children.map((task) => [task.id, task]));
  const childIds = ordered([...byTask.keys()], group?.orderedIds ?? next.childIds);
  return { ...detail, ...next, childIds, children: childIds.map((id) => byTask.get(id)!) };
}

function matchesSearch(task: TaskState, input: SearchInput, reference: string, existing?: TaskItem) {
  if (!input.includeCompleted && !active(task)) return false;
  if (input.projectId && task.projectId !== input.projectId) return false;
  if (input.priority && task.priority !== input.priority) return false;
  if (input.labelId && !task.labels.some((label) => label.id === input.labelId)) return false;
  const date = input.date;
  if (date?.kind === "today" && task.dueDate !== reference) return false;
  if (date?.kind === "overdue" && !(active(task) && task.dueDate && task.dueDate < reference)) return false;
  if (date?.kind === "none" && task.dueDate) return false;
  if (date?.kind === "range" && !(task.dueDate && date.from <= task.dueDate && task.dueDate <= date.to)) return false;
  const text = normalizeSearchText(input.text ?? "");
  if (!text) return true;
  if (normalizeSearchText(task.title).includes(text)) return true;
  if (task.description !== undefined) return normalizeSearchText(task.description).includes(text);
  // Only full descriptions can rule out a description match outside the preview.
  return normalizeSearchText(task.descriptionExcerpt ?? "").includes(text)
    || (!!existing && existing.title === task.title && existing.descriptionExcerpt === task.descriptionExcerpt);
}

export function applyTaskChanges(data: QueryData, { rows, groups = [] }: TaskChanges) {
  if (!rows.length && !groups.length) return;
  const visibleActive = (task: TaskState) => active(task) && visible(data, task);
  const labelDelta = (id: string) => membershipDelta(rows, (task) =>
    visibleActive(task) && task.labels.some((label) => label.id === id));
  const patchLabel = (label: Label) => {
    const delta = labelDelta(label.id);
    return delta ? { ...label, activeCount: Math.max(0, label.activeCount + delta) } : label;
  };
  for (const [key, value] of data) {
    if (!value) continue;
    if (key === "nav") {
      const nav = value as Navigation;
      const projectDelta = (id: string) => membershipDelta(rows, (task) => active(task) && task.projectId === id);
      const inboxCount = projectDelta(nav.inbox.projectId);
      const todayCount = membershipDelta(rows, (task) => visibleActive(task) && !!task.dueDate && task.dueDate <= nav.referenceDate);
      const labels = nav.labels.map(patchLabel);
      const projects = nav.projects.map((project) => {
        const delta = projectDelta(project.id);
        return delta ? { ...project, activeCount: Math.max(0, project.activeCount + delta) } : project;
      });
      if (inboxCount || todayCount || projects.some((project, index) => project !== nav.projects[index])
        || labels.some((label, index) => label !== nav.labels[index])) {
        data.set(key, {
          ...nav, labels, projects,
          inbox: inboxCount ? { ...nav.inbox, activeCount: Math.max(0, nav.inbox.activeCount + inboxCount) } : nav.inbox,
          todayCount: Math.max(0, nav.todayCount + todayCount),
        });
      }
    } else if (key === "labels") {
      const page = value as { labels: Label[] };
      const labels = page.labels.map(patchLabel);
      if (labels.some((label, index) => label !== page.labels[index])) data.set(key, { labels });
    } else if (key.startsWith("project:")) {
      data.set(key, patchProject(value as ProjectPage, rows, groups));
    } else if (key.startsWith("task:")) {
      data.set(key, patchDetail(value as TaskDetail, rows, groups));
    } else if (key.startsWith("today:")) {
      const page = value as TodayView;
      const overdue = updateList(page.overdue, rows, (task) => visibleActive(task) && !!task.dueDate && task.dueDate < page.referenceDate, overdueOrder);
      const today = updateList(page.today, rows, (task) => visibleActive(task) && task.dueDate === page.referenceDate, agendaOrder);
      const completed = page.completedToday && updateList(page.completedToday, rows, (task) =>
        visible(data, task) && !!task.completedAt
        && new Intl.DateTimeFormat("sv-SE", { timeZone: page.timezone }).format(new Date(task.completedAt)) === page.referenceDate, completedOrder);
      if (overdue !== page.overdue || today !== page.today || completed !== page.completedToday) {
        data.set(key, { ...page, overdue, today, ...(completed && { completedToday: completed }) });
      }
    } else if (key.startsWith("upcoming:")) {
      const page = value as UpcomingView;
      const days = page.days.map((day) => {
        const tasks = updateList(day.tasks, rows, (task) => visibleActive(task) && task.dueDate === day.date, agendaOrder);
        return tasks === day.tasks ? day : { ...day, tasks };
      });
      if (days.some((day, index) => day !== page.days[index])) data.set(key, { ...page, days });
    } else if (key.startsWith("label:")) {
      const page = value as LabelTasks;
      const tasks = updateList(page.tasks, rows, (task) => visibleActive(task) && task.labels.some((label) => label.id === key.slice(6)), byId);
      if (tasks !== page.tasks) data.set(key, { ...page, tasks });
    } else if (key.startsWith("search:")) {
      const page = value as SearchResult;
      const input: SearchInput = JSON.parse(key.slice(7));
      const existing = new Map(page.results.map((task) => [task.id, task]));
      const results = updateList(page.results, rows, (task) =>
        visible(data, task) && matchesSearch(task, input, page.referenceDate, existing.get(task.id)), (a, b) =>
        compareSearchKey({ id: a.id, completed: !active(a) }, { id: b.id, completed: !active(b) }));
      if (results !== page.results) data.set(key, { ...page, results });
    }
  }
}

export function affectedTaskQuery(key: string, value: unknown, changes: TaskChanges) {
  if (value === undefined) return false;
  const data: QueryData = new Map([[key, value]]);
  applyTaskChanges(data, changes);
  return data.get(key) !== value;
}

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureApi } from "@/client/api";
import { clearCache, getQueryData, setQueryData, useQuery } from "@/client/store";
import { completeTask, createTask, duplicateTask, editTask, moveTask, removeTask, undoTask } from "@/client/task-mutations";
import type { Navigation, ProjectPage, TaskChanges, TaskDetail, TaskState, TodayView, UpcomingView } from "@/client/types";

const reference = "2026-11-20";
const tomorrow = "2026-11-21";
const context = { reference, inboxId: "inbox" };

function task(id: string, fields: Partial<TaskState> = {}): TaskState {
  return {
    id, title: id, revision: 1, projectId: "inbox", sectionId: null, parentId: null,
    descriptionExcerpt: null, priority: 4, status: "active", completedAt: null, dueDate: reference,
    dueTime: null, overdue: false, recurrence: null, occurrenceId: null, childIds: [],
    subtasks: { total: 0, completed: 0 }, labels: [], ...fields,
  };
}

function query<T>(key: string, value: T) {
  function Register() {
    useQuery(key, () => Promise.resolve(value));
    return null;
  }
  renderToString(createElement(Register));
  setQueryData<T>(key, () => value);
  return () => getQueryData<T>(key)!;
}

function fixtures(...tasks: TaskState[]) {
  const nav = query<Navigation>("nav", {
    referenceDate: reference, todayCount: tasks.filter((item) => item.dueDate === reference).length,
    inbox: { projectId: "inbox", activeCount: tasks.length }, projects: [], archivedCount: 0,
    labels: [{ id: "tag", name: "Planejamento", revision: 1, activeCount: 0 }],
  });
  const today = query<TodayView>("today:false", {
    referenceDate: reference, timezone: "UTC", overdue: [], today: tasks.filter((item) => item.dueDate === reference),
  });
  const upcoming = query<UpcomingView>("upcoming:tomorrow", {
    referenceDate: reference, start: tomorrow, days: [{ date: tomorrow, tasks: [] }],
  });
  const project = query<ProjectPage>("project:inbox", {
    referenceDate: reference, project: {
      id: "inbox", revision: 1, name: "Caixa de entrada", description: "", defaultSectionName: null,
      color: null, icon: "hash", isInbox: true, status: "active", activeCount: tasks.length,
      view: { layout: "list", sortMode: "manual", showCompleted: false },
    },
    sections: [{ id: "section", revision: 1, name: "Seção", description: "", taskCount: 0 }],
    groups: [{ sectionId: null, rootIds: tasks.filter((item) => !item.parentId).map((item) => item.id) }, { sectionId: "section", rootIds: [] }],
    tasks,
  });
  return { nav, today, upcoming, project };
}

function delayedWrites() {
  const pending: ((response: Response) => void)[] = [];
  const fetcher = vi.fn((_url: string, _options: RequestInit) =>
    new Promise<Response>((resolve) => { pending.push(resolve); }));
  configureApi({ fetch: fetcher });
  return {
    fetcher,
    respond(index: number, result: unknown, changes: TaskChanges) {
      pending[index](Response.json({ result, changes }));
    },
    reject(index: number) {
      pending[index](Response.json({ error: { code: "VALIDATION_FAILED" } }, { status: 422 }));
    },
  };
}

afterEach(() => {
  clearCache();
  configureApi({ fetch: (input, init) => globalThis.fetch(input, init) });
});

describe("optimistic tasks", () => {
  it("inserts into the selected section, label and agenda, then adopts the server ID and order", async () => {
    const { nav, today, project } = fixtures();
    const labels = query("label:tag", { referenceDate: reference, tasks: [] as TaskState[], nextCursor: null });
    const network = delayedWrites();

    const saving = createTask(context, { title: "Materiais", sectionId: "section", dueDate: reference, labelIds: ["tag"] });
    const [temporary] = today().today;
    expect(temporary.id).toMatch(/^pending:/);
    expect(project().groups[1].rootIds).toEqual([temporary.id]);
    expect(project().sections[0].taskCount).toBe(1);
    expect(nav()).toMatchObject({ todayCount: 1, inbox: { activeCount: 1 }, labels: [{ activeCount: 1 }] });
    expect(labels().tasks.map(({ id }) => id)).toEqual([temporary.id]);

    const saved = task("official", { title: "Materiais", sectionId: "section", labels: [{ id: "tag", name: "Planejamento" }] });
    network.respond(0, saved, { revision: 7, rows: [{ after: saved }] });
    await expect(saving).resolves.toMatchObject({ id: saved.id });
    expect(today().today.map(({ id }) => id)).toEqual([saved.id]);
    expect(project().groups[1].rootIds).toEqual([saved.id]);
    expect(labels().tasks.map(({ id }) => id)).toEqual([saved.id]);
    expect(nav().todayCount).toBe(1);
    expect(network.fetcher).toHaveBeenCalledTimes(1);
  });

  it("rebases a later edit on the same task after rolling back only the failed field", async () => {
    const original = task("first");
    const { project, today, upcoming, nav } = fixtures(original);
    const network = delayedWrites();
    const failed = editTask(context, original, { title: "Rejeitada" }).catch((error) => error.code);
    const accepted = editTask(context, original, { dueDate: tomorrow, priority: 1 });
    expect(project().tasks[0]).toMatchObject({ title: "Rejeitada", dueDate: tomorrow, priority: 1 });
    expect(today().today).toEqual([]);
    expect(upcoming().days[0].tasks[0]).toMatchObject({ id: original.id });

    expect(network.fetcher).toHaveBeenCalledTimes(1);
    network.reject(0);
    await expect(failed).resolves.toBe("VALIDATION_FAILED");
    await vi.waitFor(() => expect(network.fetcher).toHaveBeenCalledTimes(2));
    expect(project().tasks[0]).toMatchObject({ title: original.title, dueDate: tomorrow, priority: 1 });
    const saved = { ...original, revision: 2, dueDate: tomorrow, priority: 1 as const };
    network.respond(1, saved, { revision: 8, rows: [{ before: original, after: saved }] });
    await accepted;
    expect(nav().todayCount).toBe(0);
    expect(project().tasks[0]).toMatchObject(saved);
  });

  it("preserves a confirmed completion while reverting a rejected concurrent deletion", async () => {
    const parent = task("parent", { childIds: ["child"], subtasks: { total: 1, completed: 0 } });
    const child = task("child", { parentId: parent.id });
    const other = task("other");
    const { project, nav } = fixtures(parent, child, other);
    const network = delayedWrites();
    const removed = removeTask(context, parent).catch((error) => error.code);
    const completed = completeTask(context, other);
    expect(project().tasks).toEqual([]);
    expect(nav().inbox.activeCount).toBe(0);

    const done = { ...other, status: "completed" as const, revision: 2, completedAt: "2026-11-20T15:00:00Z" };
    network.respond(1, { task: done }, { revision: 10, rows: [{ before: other, after: done }] });
    await completed;
    network.reject(0);
    await expect(removed).resolves.toBe("VALIDATION_FAILED");
    expect(project().groups[0].rootIds).toEqual([parent.id]);
    expect(project().tasks.map(({ id }) => id)).toEqual([parent.id, child.id]);
    expect(nav().inbox.activeCount).toBe(2);
  });

  it("uses committed move revisions across steps and keeps a successful promotion if the next step fails", async () => {
    const parent = task("parent", { childIds: ["child"], subtasks: { total: 1, completed: 0 } });
    const child = task("child", { parentId: "parent" });
    const { project } = fixtures(parent, child);
    const network = delayedWrites();
    const moving = moveTask(context, child, [
      { type: "promote" }, { type: "position", projectId: "inbox", sectionId: "section", parentId: null },
    ]).catch((error) => error.code);
    expect(project().groups[1].rootIds).toEqual([child.id]);
    const promoted = { ...child, parentId: null, revision: 2 };
    network.respond(0, { task: promoted }, {
      revision: 11,
      rows: [{ before: child, after: promoted }, { before: parent, after: { ...parent, childIds: [], subtasks: { total: 0, completed: 0 } } }],
    });
    await vi.waitFor(() => expect(network.fetcher).toHaveBeenCalledTimes(2));
    expect(JSON.parse(network.fetcher.mock.calls[1][1].body as string).revision).toBe(2);
    expect(project().groups[1].rootIds).toEqual([child.id]);
    network.reject(1);
    await expect(moving).resolves.toBe("VALIDATION_FAILED");
    expect(project().groups[0].rootIds).toEqual([parent.id, child.id]);
    expect(project().groups[1].rootIds).toEqual([]);
  });

  it("duplicates immediately with one write and uses the full server description for cached search", async () => {
    const original = task("original", { descriptionExcerpt: "Introdução" });
    const { project } = fixtures(original);
    const search = query(`search:${JSON.stringify({ text: "único" })}`, {
      referenceDate: reference, results: [original], nextCursor: "older",
    });
    const network = delayedWrites();
    const saving = duplicateTask(context, original);
    expect(project().groups[0].rootIds).toEqual([original.id, expect.stringMatching(/^pending:/)]);
    expect(network.fetcher.mock.calls[0][0]).toMatch(/\/duplicate$/);
    const copied = { ...original, id: "copy", createdAt: "2026-11-20T15:00:00Z", description: "Introdução\nConteúdo único" } as TaskDetail;
    network.respond(0, copied, { revision: 12, rows: [{ after: copied }] });
    await saving;
    expect(search().results.map(({ id }) => id)).toEqual([copied.id, original.id]);
    expect(search().nextCursor).toBe("older");
  });

  it("predicts a monthly recurrence using its nominal anchor and restores the previous occurrence on undo", async () => {
    const original = task("monthly", {
      recurrence: { frequency: "monthly" }, occurrenceId: "first-occurrence",
      recurrenceRule: { frequency: "monthly", anchorDate: "2026-01-31", nominalDate: "2026-10-31", time: "07:00" },
    });
    const { project, today } = fixtures(original);
    const network = delayedWrites();
    const completing = completeTask(context, original);
    expect(project().tasks[0]).toMatchObject({ dueDate: "2026-11-30", dueTime: "07:00", status: "active" });
    expect(today().today).toEqual([]);

    const second = { ...original, revision: 2, occurrenceId: "next-occurrence", dueDate: "2026-11-30", dueTime: "07:00" };
    network.respond(0, { task: second }, { revision: 13, rows: [{ before: original, after: second }] });
    const completed = await completing;
    const undoing = undoTask(context, completed.previous, {
      revision: second.revision, occurrenceId: completed.previous.occurrenceId!, completedChildIds: [],
    });
    expect(today().today[0]).toMatchObject({ id: original.id, dueDate: reference, occurrenceId: original.occurrenceId });
    network.respond(1, { task: { ...original, revision: 3 } }, {
      revision: 14, rows: [{ before: second, after: { ...original, revision: 3 } }],
    });
    await undoing;
    expect(today().today[0].revision).toBe(3);
  });

  it("applies overlapping group confirmations by commit revision despite reverse response order", async () => {
    const { project } = fixtures();
    const network = delayedWrites();
    const creatingFirst = createTask(context, { title: "Primeira" });
    const creatingSecond = createTask(context, { title: "Segunda" });
    const first = task("first", { title: "Primeira", dueDate: null });
    const second = task("second", { title: "Segunda", dueDate: null });
    const group = { projectId: "inbox", sectionId: null, parentId: null };
    network.respond(1, second, {
      revision: 16, rows: [{ after: second }], groups: [{ ...group, orderedIds: [first.id, second.id] }],
    });
    await creatingSecond;
    network.respond(0, first, {
      revision: 15, rows: [{ after: first }], groups: [{ ...group, orderedIds: [first.id] }],
    });
    await creatingFirst;
    expect(project().groups[0].rootIds).toEqual([first.id, second.id]);
    expect(project().project.activeCount).toBe(2);
  });
});

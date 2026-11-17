import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as changePassword } from "@/app/api/v1/auth/password/route";
import * as labels from "@/app/api/v1/labels/route";
import * as label from "@/app/api/v1/labels/[id]/route";
import * as labelTasks from "@/app/api/v1/labels/[id]/tasks/route";
import * as navigation from "@/app/api/v1/navigation/route";
import * as projects from "@/app/api/v1/projects/route";
import * as project from "@/app/api/v1/projects/[id]/route";
import * as archive from "@/app/api/v1/projects/[id]/archive/route";
import * as unarchive from "@/app/api/v1/projects/[id]/unarchive/route";
import * as projectView from "@/app/api/v1/projects/[id]/view/route";
import * as createSectionRoute from "@/app/api/v1/projects/[id]/sections/route";
import * as section from "@/app/api/v1/sections/[id]/route";
import * as moveSectionRoute from "@/app/api/v1/sections/[id]/move/route";
import * as tasks from "@/app/api/v1/tasks/route";
import * as task from "@/app/api/v1/tasks/[id]/route";
import * as complete from "@/app/api/v1/tasks/[id]/complete/route";
import * as reopen from "@/app/api/v1/tasks/[id]/reopen/route";
import * as move from "@/app/api/v1/tasks/[id]/move/route";
import { connectDatabase } from "@/server/db/client";
import { getRuntime } from "@/server/runtime";
import { createAccount } from "@/server/services/admin";
import type { getNavigation, getProject } from "@/server/services/projects";
import type { listLabelTasks } from "@/server/services/labels";
import type { completeTask, getTask, moveTask, reopenTask } from "@/server/services/tasks";

type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Resource = { id: string; revision: number };
type ProjectPage = Awaited<ReturnType<typeof getProject>>;
type Navigation = Awaited<ReturnType<typeof getNavigation>>;
type Task = Awaited<ReturnType<typeof getTask>>;

const routes: Record<string, Partial<Record<Method, Handler>>> = {
  "/auth/login": { POST: login },
  "/auth/password": { POST: changePassword },
  "/navigation": navigation,
  "/projects": projects,
  "/projects/:id": project,
  "/projects/:id/archive": archive,
  "/projects/:id/unarchive": unarchive,
  "/projects/:id/view": projectView,
  "/projects/:id/sections": createSectionRoute,
  "/sections/:id": section,
  "/sections/:id/move": moveSectionRoute,
  "/tasks": tasks,
  "/tasks/:id": task,
  "/tasks/:id/complete": complete,
  "/tasks/:id/reopen": reopen,
  "/tasks/:id/move": move,
  "/labels": labels,
  "/labels/:id": label,
  "/labels/:id/tasks": labelTasks,
};

let runtime: ReturnType<typeof getRuntime>;
let admin: ReturnType<typeof connectDatabase>;

beforeAll(() => {
  process.env.AUTH_CLIENT_IP_HEADER = "x-feito-test-ip";
  runtime = getRuntime();
  admin = connectDatabase("IDENTITY_ADMIN_DATABASE_URL", 4);
});

afterAll(async () => {
  await Promise.all([runtime?.close(), admin?.close()]);
});

function send(method: Method, path: string, cookie?: string, body?: unknown, originAllowed = true) {
  const origin = runtime.identity.config.origin;
  const addr = randomBytes(4).toString("hex");
  const headers = new Headers({ "x-feito-test-ip": `2001:db8::${addr.slice(0, 4)}:${addr.slice(4)}` });
  if (originAllowed) headers.set("Origin", origin);
  if (cookie) headers.set("Cookie", cookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const request = new Request(origin + "/api/v1" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const [pathname] = path.split("?");
  const id = pathname.split("/")[2] ?? "";
  const pattern = ["/projects/", "/sections/", "/tasks/", "/labels/"].some((prefix) => pathname.startsWith(prefix))
    ? pathname.replace(`/${id}`, "/:id") : pathname;
  const handler = routes[pattern]?.[method];
  if (!handler) throw new Error(`Missing test route ${method} ${pattern}`);
  return handler(request, { params: Promise.resolve({ id }) });
}

async function payload<T>(response: Response, status = 200) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return await response.json() as T;
}

async function failure(response: Response, status: number, code: string) {
  const body = await payload<{ error: { code: string; message: string; details?: unknown } }>(response, status);
  expect(body.error).toMatchObject({ code, message: expect.any(String) });
  return body.error;
}

async function accountFixture(provisional = false) {
  const email = `${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const store = { db: admin.db, config: runtime.identity.config };
  await createAccount(store, email, password);
  const response = await send("POST", "/auth/login", undefined, { email, password });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("__Secure-feito.session_token="))?.split(";")[0];
  expect(cookie).toBeDefined();
  const call = (method: Method, path: string, body?: unknown) => send(method, path, cookie, body);
  if (!provisional) {
    const updated = await call("POST", "/auth/password", {
      currentPassword: password, newPassword: randomBytes(24).toString("base64url"),
    });
    expect(updated.status).toBe(204);
  }
  return call;
}

type Client = Awaited<ReturnType<typeof accountFixture>>;

const newProject = (call: Client, name = "Projeto") =>
  call("POST", "/projects", { name }).then((res) => payload<ProjectPage["project"]>(res, 201));
const newSection = (call: Client, projectId: string, name = "Seção") =>
  call("POST", `/projects/${projectId}/sections`, { name }).then((res) => payload<Resource>(res, 201));
const newLabel = (call: Client, name = "Etiqueta") =>
  call("POST", "/labels", { name }).then((res) => payload<Navigation["labels"][number]>(res, 201));
const newTask = (call: Client, title: string, fields: Record<string, unknown> = {}) =>
  call("POST", "/tasks", { title, ...fields }).then((res) => payload<Task>(res, 201));
const getTaskById = (call: Client, id: string) => call("GET", `/tasks/${id}`).then((res) => payload<Task>(res));
const page = (call: Client, id: string, query = "") =>
  call("GET", `/projects/${id}${query}`).then((res) => payload<ProjectPage>(res));
const nav = (call: Client) => call("GET", "/navigation").then((res) => payload<Navigation>(res));
const completeTaskById = (call: Client, task: Resource, includeChildren?: boolean) =>
  call("POST", `/tasks/${task.id}/complete`, { revision: task.revision, includeChildren })
    .then((res) => payload<Awaited<ReturnType<typeof completeTask>>>(res));
const position = (projectId: string, sectionId: string | null = null, parentId: string | null = null) =>
  ({ type: "position" as const, projectId, sectionId, parentId });
const moveRequest = (call: Client, task: Resource, target: unknown) =>
  call("POST", `/tasks/${task.id}/move`, { revision: task.revision, target });
const moveResult = (response: Response) => payload<Awaited<ReturnType<typeof moveTask>>>(response);

describe("projects and navigation", () => {
  it("lists six projects in creation order and archives/reactivates with state intact", async () => {
    const call = await accountFixture();
    const projects = [];
    for (let index = 0; index < 6; index++) projects.push(await newProject(call, `Projeto ${index + 1}`));
    const [first] = projects;
    const inboxTask = await newTask(call, "Caixa de entrada", { dueDate: "2025-01-01" });
    const tagged = await newLabel(call, "Revisão");
    const active = await newTask(call, "Ativa", { projectId: first.id, dueDate: "2025-01-01", labelIds: [tagged.id] });
    const completed = await completeTaskById(call, await newTask(call, "Concluída", { projectId: first.id, priority: 2 }));
    const before = await nav(call);
    expect(before.projects.map(({ id }) => id)).toEqual(projects.map(({ id }) => id));
    expect(before).toMatchObject({ todayCount: 2, inbox: { projectId: inboxTask.projectId, activeCount: 1 }, archivedCount: 0 });
    expect(before.labels[0].activeCount).toBe(1);
    const expectedTasks = (await page(call, first.id, "?includeCompleted=true")).tasks;

    const archived = await payload<ProjectPage["project"]>(await call("POST", `/projects/${first.id}/archive`, { revision: first.revision }));
    expect(archived).toMatchObject({ status: "archived", activeCount: 0 });
    expect(await nav(call)).toMatchObject({ archivedCount: 1, todayCount: 1, labels: [{ id: tagged.id, activeCount: 0 }] });
    expect(await payload<{ projects: Resource[] }>(await call("GET", "/projects?status=archived")))
      .toMatchObject({ projects: [{ id: first.id }] });
    const archivedPage = await page(call, first.id, "?includeCompleted=true");
    expect(archivedPage.tasks).toEqual(expectedTasks);
    expect(await getTaskById(call, completed.task.id)).toMatchObject({ status: "completed" });
    await failure(await call("POST", "/tasks", { title: "Bloqueada", projectId: first.id }), 409, "PROJECT_ARCHIVED");
    await failure(await call("PATCH", `/tasks/${active.id}`, { revision: active.revision, title: "Bloqueada" }), 409, "PROJECT_ARCHIVED");
    await failure(await moveRequest(call, inboxTask, position(first.id)), 409, "PROJECT_ARCHIVED");
    await failure(await moveRequest(call, active, position(inboxTask.projectId)), 409, "PROJECT_ARCHIVED");
    const restored = await payload<ProjectPage["project"]>(await call("POST", `/projects/${first.id}/unarchive`, { revision: archived.revision }));
    expect(restored).toMatchObject({ status: "active", activeCount: 1 });
    expect((await page(call, first.id, "?includeCompleted=true")).tasks).toEqual(expectedTasks);
    const notEmpty = await failure(await call("DELETE", `/projects/${first.id}?revision=${restored.revision}`), 409, "PROJECT_NOT_EMPTY");
    expect(notEmpty.details).toEqual({ activeCount: 1, completedCount: 1 });
  });

  it("protects Inbox and applies project revisions and view preferences", async () => {
    const call = await accountFixture();
    const { projectId: inboxId } = (await nav(call)).inbox;
    const inbox = (await page(call, inboxId)).project;
    expect(inbox).toMatchObject({ name: "Caixa de entrada", isInbox: true });
    await failure(await call("PATCH", `/projects/${inbox.id}`, { revision: inbox.revision, name: "Outro" }), 422, "INBOX_PROTECTED");
    await failure(await call("POST", `/projects/${inbox.id}/archive`, { revision: inbox.revision }), 422, "INBOX_PROTECTED");
    await failure(await call("DELETE", `/projects/${inbox.id}?revision=${inbox.revision}`), 422, "INBOX_PROTECTED");
    await failure(await call("POST", `/projects/${inbox.id}/sections`, { name: "Outra" }), 422, "INBOX_PROTECTED");
    await failure(await call("PATCH", `/projects/${inbox.id}/view`, { layout: "board" }), 422, "VALIDATION_FAILED");

    const project = await newProject(call, " Original ");
    expect(project.name).toBe("Original");
    const requests = await Promise.all([
      call("PATCH", `/projects/${project.id}`, { revision: project.revision, name: "Versão A" }),
      call("PATCH", `/projects/${project.id}`, { revision: project.revision, name: "Versão B" }),
    ]);
    const updated = await payload<ProjectPage["project"]>(requests.find((response) => response.status === 200)!);
    const conflict = await failure(requests.find((response) => response.status === 409)!, 409, "REVISION_CONFLICT");
    expect(conflict.details).toEqual({ current: updated });

    const done = await completeTaskById(call, await newTask(call, "Concluída", { projectId: project.id }));
    expect((await page(call, project.id)).tasks).toEqual([]);
    const view = await payload(await call("PATCH", `/projects/${project.id}/view`, { showCompleted: true }));
    expect(view).toEqual({ layout: "list", sortMode: "manual", showCompleted: true });
    expect((await page(call, project.id)).tasks).toMatchObject([{ id: done.task.id }]);
    expect((await page(call, project.id, "?includeCompleted=false")).tasks).toEqual([]);
    await failure(await call("GET", `/projects/${project.id}?includeCompleted=false&includeCompleted=true`), 422, "VALIDATION_FAILED");
    const empty = await newProject(call, "Vazio");
    const emptySection = await newSection(call, empty.id);
    expect((await call("DELETE", `/projects/${empty.id}?revision=${empty.revision}`)).status).toBe(204);
    await failure(await call("GET", `/projects/${empty.id}`), 404, "NOT_FOUND");
    await failure(await call("PATCH", `/sections/${emptySection.id}`, { revision: emptySection.revision, name: "Ausente" }), 404, "NOT_FOUND");
  });
});

describe("sections and task movement", () => {
  it("orders sections and moves entire trees to the end of the unsectioned group on deletion", async () => {
    const call = await accountFixture();
    const project = await newProject(call);
    const one = await newSection(call, project.id, "Uma");
    const two = await newSection(call, project.id, "Duas");
    const inserted = await payload<Resource>(await call("POST", `/projects/${project.id}/sections`, {
      name: "Inserida", beforeSectionId: two.id,
    }), 201);
    expect((await page(call, project.id)).sections.map(({ id }) => id)).toEqual([one.id, inserted.id, two.id]);
    const latestTwo = (await page(call, project.id)).sections.at(-1)!;
    const moved = await payload<{ sectionIds: string[] }>(await call("POST", `/sections/${two.id}/move`, {
      revision: latestTwo.revision, beforeSectionId: one.id,
    }));
    expect(moved.sectionIds).toEqual([two.id, one.id, inserted.id]);
    const latestOne = (await page(call, project.id)).sections[1];
    const renamed = await payload<Resource>(await call("PATCH", `/sections/${one.id}`, { revision: latestOne.revision, name: "Nova" }));
    const existing = await newTask(call, "Sem seção", { projectId: project.id });
    const first = await newTask(call, "Raiz", { projectId: project.id, sectionId: one.id });
    const kid = await newTask(call, "Filha", { parentId: first.id, projectId: randomUUID(), sectionId: randomUUID() });
    const second = await newTask(call, "Segunda", { projectId: project.id, sectionId: one.id });
    const done = await completeTaskById(call, kid);
    expect(done.task).toMatchObject({ status: "completed", parentId: first.id, sectionId: one.id });
    expect((await page(call, project.id)).sections[1]).toMatchObject({ id: one.id, taskCount: 3 });
    expect(await payload(await call("DELETE", `/sections/${one.id}?revision=${renamed.revision}`)))
      .toEqual({ movedTaskCount: 3 });
    expect((await page(call, project.id, "?includeCompleted=true")).groups[0].rootIds)
      .toEqual([existing.id, first.id, second.id]);
    expect(await getTaskById(call, kid.id)).toMatchObject({ sectionId: null, parentId: first.id, status: "completed" });
  });

  it("reorders, changes columns, nests, promotes and moves a root with its children between projects", async () => {
    const call = await accountFixture();
    const first = await newProject(call, "Origem");
    const second = await newProject(call, "Destino");
    const a = await newSection(call, first.id, "A");
    const b = await newSection(call, first.id, "B");
    const other = await newSection(call, second.id, "Outra");
    const firstTask = await newTask(call, "Primeira", positionFields(first.id, a.id));
    const secondTask = await newTask(call, "Segunda", positionFields(first.id, a.id));
    const moved = await moveResult(await moveRequest(call, secondTask, { ...position(first.id, a.id), beforeId: firstTask.id }));
    expect(moved.groups).toEqual([{ ...positionFields(first.id, a.id), parentId: null, orderedIds: [secondTask.id, firstTask.id] }]);
    const column = await moveResult(await moveRequest(call, moved.task, position(first.id, b.id)));
    expect(column.groups.map(({ sectionId, orderedIds }) => ({ sectionId, orderedIds }))).toEqual([
      { sectionId: a.id, orderedIds: [firstTask.id] }, { sectionId: b.id, orderedIds: [secondTask.id] },
    ]);
    const root = await newTask(call, "Pai", positionFields(first.id, b.id));
    const nested = await moveResult(await moveRequest(call, column.task, position(first.id, b.id, root.id)));
    expect(nested.task).toMatchObject({ id: secondTask.id, parentId: root.id, sectionId: b.id });
    const rootHere = await getTaskById(call, root.id);
    expect(rootHere.childIds).toEqual([secondTask.id]);
    const changedProject = await moveResult(await moveRequest(call, rootHere, position(second.id, other.id)));
    expect(changedProject.task).toMatchObject({ id: root.id, projectId: second.id, sectionId: other.id });
    const childHere = await getTaskById(call, secondTask.id);
    expect(childHere).toMatchObject({ parentId: root.id, projectId: second.id, sectionId: other.id });
    const promoted = await moveResult(await moveRequest(call, childHere, { type: "promote" }));
    expect(promoted.task.parentId).toBeNull();
    expect(promoted.groups.at(-1)?.orderedIds).toEqual([root.id, secondTask.id]);
  });

  it("rejects each invalid move and restores saved order after temporary automatic sorts", async () => {
    const call = await accountFixture();
    const p = await newProject(call);
    const otherProject = await newProject(call, "Outro");
    const a = await newSection(call, p.id, "A");
    const b = await newSection(call, p.id, "B");
    const first = await newTask(call, "Sem data", { ...positionFields(p.id, a.id), priority: 4 });
    const second = await newTask(call, "Com data", { ...positionFields(p.id, a.id), priority: 1, dueDate: "2026-11-17" });
    const other = await newTask(call, "Outra seção", positionFields(p.id, b.id));
    const outside = await newTask(call, "Outro projeto", { projectId: otherProject.id });
    const kid = await newTask(call, "Filha", { parentId: first.id });
    const daily = await newTask(call, "Recorrente", {
      ...positionFields(p.id, b.id), dueDate: "2026-11-17", recurrence: { frequency: "daily" },
    });
    const done = await completeTaskById(call, await newTask(call, "Concluída", positionFields(p.id, b.id)));

    await failure(await moveRequest(call, done.task, position(p.id, a.id)), 409, "TASK_COMPLETED");
    for (const invalid of [second.id, kid.id, done.task.id, daily.id, outside.id]) {
      await failure(await moveRequest(call, second, position(p.id, a.id, invalid)), 422, "INVALID_PARENT");
    }
    await failure(await moveRequest(call, first, position(p.id, b.id, other.id)), 422, "DEPTH_EXCEEDED");
    await failure(await moveRequest(call, daily, position(p.id, b.id, other.id)), 422, "RECURRENCE_NOT_ALLOWED");
    await failure(await moveRequest(call, kid, position(p.id, b.id, other.id)), 422, "MUST_PROMOTE_FIRST");
    await failure(await moveRequest(call, kid, position(otherProject.id, null, outside.id)), 422, "MUST_PROMOTE_FIRST");
    await failure(await moveRequest(call, second, { ...position(p.id, a.id), afterId: other.id }), 422, "INVALID_ANCHOR");
    await failure(await moveRequest(call, second, { ...position(p.id, a.id), afterId: second.id }), 422, "INVALID_ANCHOR");
    await failure(await moveRequest(call, second, { ...position(p.id, a.id), afterId: randomUUID() }), 404, "NOT_FOUND");

    const locateRoots = async () => (await page(call, p.id)).groups.find((group) => group.sectionId === a.id)?.rootIds;
    expect(await locateRoots()).toEqual([first.id, second.id]);
    for (const sortMode of ["priority", "date"]) {
      expect((await call("PATCH", `/projects/${p.id}/view`, { layout: "board", sortMode })).status).toBe(200);
      expect(await locateRoots()).toEqual([second.id, first.id]);
      await failure(await moveRequest(call, second, { ...position(p.id, a.id), beforeId: first.id }), 409, "SORT_NOT_MANUAL");
    }
    expect((await call("PATCH", `/projects/${p.id}/view`, { layout: "list", sortMode: "manual" })).status).toBe(200);
    expect(await locateRoots()).toEqual([first.id, second.id]);
    expect((await call("PATCH", `/projects/${p.id}/view`, { sortMode: "priority" })).status).toBe(200);
    const unanchored = await moveResult(await moveRequest(call, other, position(p.id)));
    expect(unanchored.task.sectionId).toBeNull();
  });
});

function positionFields(projectId: string, sectionId: string) {
  return { projectId, sectionId };
}

describe("tasks, labels and cross-account isolation", () => {
  it("validates scheduling, preserves placement on complete/reopen and requires subtree confirmation", async () => {
    const call = await accountFixture();
    const project = await newProject(call);
    const section = await newSection(call, project.id);
    const root = await newTask(call, " Tarefa ", {
      ...positionFields(project.id, section.id), dueDate: "2025-01-01", dueTime: "08:30",
      description: "\n   \nPrimeira linha\nSegunda",
    });
    expect(root).toMatchObject({ title: "Tarefa", descriptionExcerpt: "Primeira linha", priority: 4, overdue: true });
    const long = "😀".repeat(10_000);
    const unicode = await newTask(call, "🧪".repeat(500), { description: long });
    expect(unicode.description).toBe(long);
    await failure(await call("POST", "/tasks", { title: "Tamanho excedido", description: long + "a" }),
      422, "VALIDATION_FAILED");
    await failure(await call("POST", "/tasks", { title: "Data impossível", dueDate: "2026-02-30" }), 422, "VALIDATION_FAILED");
    await failure(await call("POST", "/tasks", { title: "Só hora", dueTime: "08:00" }), 422, "VALIDATION_FAILED");
    const scheduled = await payload<Task>(await call("PATCH", `/tasks/${root.id}`, { revision: root.revision, dueDate: "2025-02-01" }));
    expect(scheduled.dueTime).toBe("08:30");
    const unscheduled = await payload<Task>(await call("PATCH", `/tasks/${root.id}`, { revision: scheduled.revision, dueDate: null }));
    expect(unscheduled).toMatchObject({ dueTime: null, dueDate: null });
    const stale = await failure(await call("PATCH", `/tasks/${root.id}`, { revision: root.revision, title: "Conflito" }), 409, "REVISION_CONFLICT");
    expect(stale.details).toEqual({ current: unscheduled });
    const child = await newTask(call, "Filha", { parentId: root.id, dueDate: "2025-01-01" });
    const blocked = await failure(await call("POST", `/tasks/${root.id}/complete`, { revision: unscheduled.revision }), 409, "HAS_ACTIVE_CHILDREN");
    expect(blocked.details).toEqual({ activeChildCount: 1 });
    const finished = await completeTaskById(call, unscheduled, true);
    expect(finished).toMatchObject({
      task: { status: "completed", sectionId: section.id, subtasks: { completed: 1, total: 1 } },
      completedChildIds: [child.id], alreadyProcessed: false,
    });
    const hidden = await page(call, project.id);
    expect(hidden.groups[1].rootIds).toEqual([]);
    const withCompleted = await page(call, project.id, "?includeCompleted=true");
    expect(withCompleted.groups[1].rootIds).toEqual([root.id]);
    await failure(await call("PATCH", `/tasks/${root.id}`, { revision: finished.task.revision, title: "Bloqueada" }), 409, "TASK_COMPLETED");
    const finishedChild = await getTaskById(call, child.id);
    const reopened = await payload<Awaited<ReturnType<typeof reopenTask>>>(await call("POST", `/tasks/${child.id}/reopen`, {
      revision: finishedChild.revision,
    }));
    expect(reopened).toMatchObject({ reopenedParentId: root.id, task: { status: "active", overdue: true, sectionId: section.id } });
    const reopenedRoot = await getTaskById(call, root.id);
    expect(reopenedRoot).toMatchObject({ status: "active", childIds: [child.id] });
    const forbidden = await failure(await call("DELETE", `/tasks/${root.id}?revision=${reopenedRoot.revision}`), 409, "HAS_CHILDREN");
    expect(forbidden.details).toEqual({ childCount: 1 });
    expect((await call("DELETE", `/tasks/${root.id}?revision=${reopenedRoot.revision}&withChildren=true`)).status).toBe(204);
    await failure(await call("GET", `/tasks/${child.id}`), 404, "NOT_FOUND");
  });

  it("normalizes labels, paginates visible tasks and removes links from active and completed tasks", async () => {
    const call = await accountFixture();
    const replies = await Promise.all([
      call("POST", "/labels", { name: " Café " }), call("POST", "/labels", { name: "CAFE\u0301" }),
    ]);
    const label = await payload<Navigation["labels"][number]>(replies.find((response) => response.status === 201)!, 201);
    const duplicate = await failure(replies.find((response) => response.status === 409)!, 409, "LABEL_EXISTS");
    expect(duplicate.details).toEqual({ id: label.id });
    const distinct = await newLabel(call, "Cafe");
    const done = await completeTaskById(call, await newTask(call, "Concluída", { labelIds: [label.id] }));
    const parent = await newTask(call, "Pai", { labelIds: [label.id, label.id] });
    const child = await newTask(call, "Filha", { parentId: parent.id, labelIds: [label.id] });
    const archived = await newProject(call, "Arquivo");
    await newTask(call, "Arquivada", { projectId: archived.id, labelIds: [label.id] });
    expect((await call("POST", `/projects/${archived.id}/archive`, { revision: archived.revision })).status).toBe(200);

    const listed = await payload<{ labels: Navigation["labels"] }>(await call("GET", "/labels"));
    expect(listed.labels.find(({ id }) => id === label.id)?.activeCount).toBe(2);
    type Page = Awaited<ReturnType<typeof listLabelTasks>>;
    const first = await payload<Page>(await call("GET", `/labels/${label.id}/tasks?limit=1`));
    expect(first.nextCursor).toBeTruthy();
    const second = await payload<Page>(await call("GET", `/labels/${label.id}/tasks?limit=1&cursor=${first.nextCursor}`));
    expect(second.nextCursor).toBeNull();
    expect([first.tasks[0].id, second.tasks[0].id].sort()).toEqual([parent.id, child.id].sort());
    expect([first.tasks[0], second.tasks[0]].find((task) => task.id === child.id)?.origin).toMatchObject({
      parentTitle: "Pai", projectName: "Caixa de entrada", isInbox: true, sectionName: null,
    });
    await failure(await call("GET", `/labels/${distinct.id}/tasks?cursor=${first.nextCursor}`), 422, "VALIDATION_FAILED");
    await failure(await call("GET", `/labels/${label.id}/tasks?limit=201`), 422, "VALIDATION_FAILED");
    const renamed = await payload<Navigation["labels"][number]>(await call("PATCH", `/labels/${label.id}`, {
      revision: label.revision, name: "Trabalho",
    }));
    expect(renamed).toMatchObject({ name: "Trabalho", activeCount: 2 });
    expect((await call("DELETE", `/labels/${label.id}?revision=${renamed.revision}`)).status).toBe(204);
    const reactivated = await payload<Awaited<ReturnType<typeof reopenTask>>>(await call("POST", `/tasks/${done.task.id}/reopen`, {
      revision: done.task.revision,
    }));
    expect(reactivated.task.labels).toEqual([]);
    expect((await getTaskById(call, parent.id)).labels).toEqual([]);
    const linked = await payload<Task>(await call("PATCH", `/tasks/${parent.id}`, {
      revision: parent.revision, labelIds: [distinct.id],
    }));
    expect(linked.labels).toEqual([{ id: distinct.id, name: "Cafe" }]);
  });

  it("returns indistinguishable 404 for foreign or missing IDs and gates every new product route", async () => {
    const [one, two] = await Promise.all([accountFixture(), accountFixture()]);
    const p1 = await newProject(one);
    const s1 = await newSection(one, p1.id);
    const l1 = await newLabel(one);
    const t1 = await newTask(one, "A", { ...positionFields(p1.id, s1.id), labelIds: [l1.id] });
    const localTask = await newTask(two, "B");
    const foreign = await failure(await two("GET", `/tasks/${t1.id}`), 404, "NOT_FOUND");
    const missing = await failure(await two("GET", `/tasks/${randomUUID()}`), 404, "NOT_FOUND");
    expect(foreign).toEqual(missing);
    await failure(await two("GET", `/projects/${p1.id}`), 404, "NOT_FOUND");
    await failure(await two("PATCH", `/sections/${s1.id}`, { revision: s1.revision, name: "Alheia" }), 404, "NOT_FOUND");
    await failure(await two("GET", `/labels/${l1.id}/tasks`), 404, "NOT_FOUND");
    await failure(await two("POST", "/tasks", { title: "Pai alheio", parentId: t1.id }), 404, "NOT_FOUND");
    await failure(await two("POST", "/tasks", { title: "Etiqueta alheia", labelIds: [l1.id] }), 404, "NOT_FOUND");
    await failure(await moveRequest(two, localTask, position(p1.id)), 404, "NOT_FOUND");
    await failure(await send("POST", "/tasks", undefined, { title: "Sem origem" }, false), 403, "FORBIDDEN_ORIGIN");
    await failure(await send("GET", "/navigation"), 401, "UNAUTHENTICATED");
    const provisional = await accountFixture(true);
    await failure(await provisional("GET", "/navigation"), 403, "PASSWORD_CHANGE_REQUIRED");
    await failure(await provisional("POST", "/tasks", { title: "Bloqueada" }), 403, "PASSWORD_CHANGE_REQUIRED");
  });
});

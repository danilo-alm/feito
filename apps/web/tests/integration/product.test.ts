import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tasks } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import type { listLabelTasks } from "@/server/services/labels";
import type { reopenTask } from "@/server/services/tasks";
import {
  accountFixture, completeTaskById, failure, getTaskById, moveRequest, moveResult, nav, newLabel,
  newProject, newSection, newTask, page, payload, position, productAccess, send, type Navigation, type ProjectPage,
  type Resource, type Task,
} from "./product-client";

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
    for (const layout of ["calendar", "table", "list"]) {
      expect(await payload<{ layout: string }>(await call("PATCH", `/projects/${inbox.id}/view`, { layout }))).toMatchObject({ layout });
    }

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

describe("manual order of projects and labels", () => {
  it("moves projects and labels, keeps the order across reads and isolates accounts", async () => {
    const call = await accountFixture();
    const other = await accountFixture();
    const [a, b, c] = [await newProject(call, "A"), await newProject(call, "B"), await newProject(call, "C")];
    const ids = async () => (await nav(call)).projects.map(({ id }) => id);
    expect(await ids()).toEqual([a.id, b.id, c.id]);

    expect(await payload(await call("POST", `/projects/${c.id}/move`, { beforeId: a.id }))).toEqual({ projectIds: [c.id, a.id, b.id] });
    expect(await ids()).toEqual([c.id, a.id, b.id]);
    expect((await payload<{ projects: Resource[] }>(await call("GET", "/projects"))).projects.map(({ id }) => id))
      .toEqual([c.id, a.id, b.id]);
    const d = await newProject(call, "D");
    expect(await ids()).toEqual([c.id, a.id, b.id, d.id]);

    const inboxId = (await nav(call)).inbox.projectId;
    await failure(await call("POST", `/projects/${inboxId}/move`, {}), 422, "INBOX_PROTECTED");
    await failure(await call("POST", `/projects/${a.id}/move`, { beforeId: inboxId }), 422, "INVALID_ANCHOR");
    await failure(await call("POST", `/projects/${a.id}/move`, { beforeId: b.id, afterId: c.id }), 422, "VALIDATION_FAILED");
    await failure(await call("POST", `/projects/${a.id}/move`, {}, { headers: { Origin: "https://other.example.test" } }), 403, "FORBIDDEN_ORIGIN");
    await failure(await other("POST", `/projects/${a.id}/move`, {}), 404, "NOT_FOUND");
    expect(await ids()).toEqual([c.id, a.id, b.id, d.id]);

    const [casa, rua] = [await newLabel(call, "casa"), await newLabel(call, "rua")];
    expect(await payload(await call("POST", `/labels/${rua.id}/move`, { beforeId: casa.id }))).toEqual({ labelIds: [rua.id, casa.id] });
    const current = (await nav(call)).labels.find(({ id }) => id === casa.id)!;
    await payload(await call("PATCH", `/labels/${casa.id}`, { revision: current.revision, name: "lar" }));
    expect((await nav(call)).labels.map(({ name }) => name)).toEqual(["rua", "lar"]);
    expect((await payload<{ labels: Resource[] }>(await call("GET", "/labels"))).labels.map(({ id }) => id)).toEqual([rua.id, casa.id]);
    await failure(await other("POST", `/labels/${rua.id}/move`, {}), 404, "NOT_FOUND");
  });
});

describe("sections and task movement", () => {
  it("moves a subtask and its descendants as a root, without detaching it on failure", async () => {
    const call = await accountFixture();
    const source = await newProject(call, "Origem");
    const target = await newProject(call, "Destino");
    const section = await newSection(call, target.id, "Receber");
    const parent = await newTask(call, "Tarefa principal", { projectId: source.id });
    const nested = await newTask(call, "Subtarefa", { parentId: parent.id });
    const descendant = await newTask(call, "Descendente", { parentId: nested.id });
    const current = await getTaskById(call, nested.id);
    const request = { revision: current.revision, destination: { projectId: target.id, sectionId: section.id } };
    const archived = await payload<Resource>(await call("POST", `/projects/${target.id}/archive`, { revision: target.revision }));
    await failure(await call("PATCH", `/tasks/${nested.id}`, request), 409, "PROJECT_ARCHIVED");
    expect(await getTaskById(call, nested.id)).toEqual(current);
    expect(await getTaskById(call, descendant.id)).toMatchObject({ projectId: source.id, parentId: nested.id });

    await payload(await call("POST", `/projects/${target.id}/unarchive`, { revision: archived.revision }));
    const moved = await payload<Task>(await call("PATCH", `/tasks/${nested.id}`, request));
    expect(moved).toMatchObject({
      revision: current.revision + 1, projectId: target.id, sectionId: section.id, parentId: null,
      children: [{ id: descendant.id, projectId: target.id, sectionId: section.id, parentId: nested.id }],
    });
    expect((await getTaskById(call, parent.id)).childIds).toEqual([]);
  });

  it("stores and edits optional project and section descriptions independently of their names", async () => {
    const call = await accountFixture();
    const project = await payload<ProjectPage["project"]>(await call("POST", "/projects", {
      name: "Reforma", description: "Planejamento\nMateriais",
    }), 201);
    const section = await payload<ProjectPage["sections"][number]>(await call("POST", `/projects/${project.id}/sections`, {
      name: "Compras", description: "Pesquisar preços.",
    }), 201);
    expect(await page(call, project.id)).toMatchObject({
      project: { name: "Reforma", description: "Planejamento\nMateriais" },
      sections: [{ name: "Compras", description: "Pesquisar preços." }],
    });
    expect(await payload(await call("PATCH", `/projects/${project.id}`, { revision: project.revision, description: "" })))
      .toMatchObject({ name: "Reforma", description: "" });
    const renamed = await payload<ProjectPage["sections"][number]>(await call("PATCH", `/sections/${section.id}`, {
      revision: section.revision, name: "Cotações",
    }));
    expect(renamed).toMatchObject({ description: "Pesquisar preços." });
    expect(await payload(await call("PATCH", `/sections/${section.id}`, { revision: renamed.revision, description: "Comparar lojas." })))
      .toMatchObject({ name: "Cotações", description: "Comparar lojas." });
    await failure(await call("POST", `/projects/${project.id}/sections`, {
      name: "Muito longa", description: "a".repeat(10_001),
    }), 422, "VALIDATION_FAILED");
  });

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
    const grandchild = await newTask(call, "Neta", { parentId: kid.id });
    const second = await newTask(call, "Segunda", { projectId: project.id, sectionId: one.id });
    const done = await completeTaskById(call, kid, true);
    expect(done.task).toMatchObject({ status: "completed", parentId: first.id, sectionId: one.id });
    expect((await page(call, project.id)).sections[1]).toMatchObject({ id: one.id, taskCount: 4 });
    expect(await payload(await call("DELETE", `/sections/${one.id}?revision=${renamed.revision}`)))
      .toEqual({ movedTaskCount: 4 });
    expect((await page(call, project.id, "?includeCompleted=true")).groups[0].rootIds)
      .toEqual([existing.id, first.id, second.id]);
    expect(await getTaskById(call, kid.id)).toMatchObject({ sectionId: null, parentId: first.id, status: "completed" });
    expect(await getTaskById(call, grandchild.id)).toMatchObject({ sectionId: null, parentId: kid.id, status: "completed" });
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
    const grandchild = await newTask(call, "Neta", { parentId: nested.task.id });
    const rootHere = await getTaskById(call, root.id);
    expect(rootHere.childIds).toEqual([secondTask.id]);
    const changedProject = await moveResult(await moveRequest(call, rootHere, position(second.id, other.id)));
    expect(changedProject.task).toMatchObject({ id: root.id, projectId: second.id, sectionId: other.id });
    const childHere = await getTaskById(call, secondTask.id);
    expect(childHere).toMatchObject({ parentId: root.id, projectId: second.id, sectionId: other.id });
    const grandchildHere = await getTaskById(call, grandchild.id);
    expect(grandchildHere).toMatchObject({ parentId: secondTask.id, projectId: second.id, sectionId: other.id });
    const promotedOneLevel = await moveResult(await moveRequest(call, grandchildHere, { type: "promote" }));
    expect(promotedOneLevel.task.parentId).toBe(root.id);
    expect(promotedOneLevel.groups.at(-1)?.orderedIds).toEqual([secondTask.id, grandchild.id]);
    const promoted = await moveResult(await moveRequest(call, await getTaskById(call, secondTask.id), { type: "promote" }));
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
    const grandchild = await newTask(call, "Neta", { parentId: kid.id });
    const daily = await newTask(call, "Recorrente", {
      ...positionFields(p.id, b.id), dueDate: "2026-11-17", recurrence: { frequency: "daily" },
    });
    const done = await completeTaskById(call, await newTask(call, "Concluída", positionFields(p.id, b.id)));

    await failure(await moveRequest(call, done.task, position(p.id, a.id)), 409, "TASK_COMPLETED");
    for (const invalid of [second.id, done.task.id, daily.id, outside.id]) {
      await failure(await moveRequest(call, second, position(p.id, a.id, invalid)), 422, "INVALID_PARENT");
    }
    await failure(await moveRequest(call, first, position(p.id, a.id, grandchild.id)), 422, "INVALID_PARENT");
    await failure(await moveRequest(call, daily, position(p.id, b.id, other.id)), 422, "RECURRENCE_NOT_ALLOWED");
    await failure(await moveRequest(call, kid, position(p.id, b.id, other.id)), 422, "MUST_PROMOTE_FIRST");
    await failure(await moveRequest(call, kid, position(otherProject.id, null, outside.id)), 422, "MUST_PROMOTE_FIRST");
    await failure(await moveRequest(call, kid, position(otherProject.id)), 422, "MUST_PROMOTE_FIRST");
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

  it("moves a subtask directly into the roots of another section", async () => {
    const call = await accountFixture();
    const project = await newProject(call);
    const origin = await newSection(call, project.id, "Origem");
    const destination = await newSection(call, project.id, "Destino");
    const parent = await newTask(call, "Pai", positionFields(project.id, origin.id));
    const child = await newTask(call, "Subtarefa a mover", { parentId: parent.id });
    const sibling = await newTask(call, "Subtarefa que fica", { parentId: parent.id });
    const anchor = await newTask(call, "Tarefa de destino", positionFields(project.id, destination.id));

    const moved = await moveResult(await moveRequest(call, child, { ...position(project.id, destination.id), beforeId: anchor.id }));
    expect(moved.task).toMatchObject({ id: child.id, parentId: null, sectionId: destination.id });
    expect(moved.groups).toEqual([
      { ...positionFields(project.id, origin.id), parentId: parent.id, orderedIds: [sibling.id] },
      { ...positionFields(project.id, destination.id), parentId: null, orderedIds: [child.id, anchor.id] },
    ]);
    expect(await getTaskById(call, parent.id)).toMatchObject({ sectionId: origin.id, childIds: [sibling.id] });
  });
});

function positionFields(projectId: string, sectionId: string) {
  return { projectId, sectionId };
}

describe("tasks, labels and cross-account isolation", () => {
  it("commits fields, labels, recurrence and destination together", async () => {
    const call = await accountFixture();
    const project = await newProject(call, "Destino");
    const other = await newProject(call, "Outro");
    const wrongSection = await newSection(call, other.id, "Seção de outro projeto");
    const label = await newLabel(call, "Planejamento");
    const task = await newTask(call, "Antes");
    const before = await getTaskById(call, task.id);
    const patch = {
      revision: before.revision, title: "Depois", priority: 1, labelIds: [label.id],
      recurrence: { frequency: "weekly", anchorDate: "2028-02-01", time: "09:30" },
    };
    await failure(await call("PATCH", `/tasks/${task.id}`, {
      ...patch, destination: { projectId: project.id, sectionId: wrongSection.id },
    }), 422, "VALIDATION_FAILED");
    expect(await getTaskById(call, task.id)).toEqual(before);

    const edited = await payload<Task>(await call("PATCH", `/tasks/${task.id}`, {
      ...patch, destination: { projectId: project.id, sectionId: null },
    }));
    expect(edited).toMatchObject({
      title: "Depois", priority: 1, revision: before.revision + 1, projectId: project.id,
      dueDate: "2028-02-01", dueTime: "09:30", labels: [{ id: label.id }],
      recurrenceRule: { frequency: "weekly", anchorDate: "2028-02-01" },
    });
    expect(await getTaskById(call, task.id)).toEqual(edited);
    expect(await payload<Task>(await call("PATCH", `/tasks/${task.id}`, {
      revision: edited.revision, recurrence: null, dueDate: null,
    }))).toMatchObject({ dueDate: null, dueTime: null, recurrenceRule: null, occurrenceId: null });
  });

  it("keeps project and detail reads independent of unrelated encrypted records", async () => {
    const call = await accountFixture();
    const focus = await newProject(call, "Projeto solicitado");
    const unrelated = await newProject(call, "Outro projeto");
    const section = await newSection(call, focus.id, "Revisão");
    const label = await newLabel(call, "Importante");
    const parent = await newTask(call, "Pai", { projectId: focus.id, sectionId: section.id });
    const task = await newTask(call, "Alvo", { parentId: parent.id });
    const child = await newTask(call, "Filho", { parentId: task.id, labelIds: [label.id] });
    const grandchild = await newTask(call, "Neto", { parentId: child.id });
    const deeper = await newTask(call, "Uma camada mais fundo", { parentId: grandchild.id });
    const outside = await newTask(call, "Fora do projeto", { projectId: unrelated.id });
    await completeTaskById(call, grandchild, true);
    const before = await getTaskById(call, task.id);
    expect(before).toMatchObject({
      origin: { projectName: focus.name, sectionName: "Revisão", parentTitle: parent.title },
      children: [{ id: child.id, labels: [{ id: label.id }], childIds: [grandchild.id], subtasks: { total: 1, completed: 1 } }],
    });
    const projectBefore = await page(call, focus.id, "?includeCompleted=true");
    const { db, tenantId } = productAccess(call);
    const damage = (id: string) => withTenant(db, tenantId, (tx) => tx.update(tasks).set({ tag: Buffer.alloc(16) }).where(eq(tasks.id, id)));
    await damage(outside.id);
    expect(await page(call, focus.id, "?includeCompleted=true")).toEqual(projectBefore);
    await damage(deeper.id);
    expect(await getTaskById(call, task.id)).toEqual(before);
  });

  it("completes, undoes, reopens and deletes a branch beyond the overview depth", async () => {
    const call = await accountFixture();
    const project = await newProject(call);
    const root = await newTask(call, "Raiz", { projectId: project.id });
    const branch = [root];
    for (let depth = 1; depth <= 7; depth++) {
      branch.push(await newTask(call, `Nível ${depth}`, { parentId: branch.at(-1)!.id }));
    }
    const leaf = branch.at(-1)!;
    const alreadyCompleted = await completeTaskById(call, await newTask(call, "Já concluída", { parentId: root.id }));
    const ids = branch.map(({ id }) => id);
    expect((await page(call, project.id)).tasks.map(({ id }) => id)).toEqual(ids);
    expect(await getTaskById(call, branch[5].id)).toMatchObject({
      origin: { parentTitle: branch[4].title },
      children: [{ id: branch[6].id, childIds: [leaf.id] }],
    });

    const blocked = await failure(await call("POST", `/tasks/${root.id}/complete`, { revision: root.revision }), 409, "HAS_ACTIVE_CHILDREN");
    expect(blocked.details).toEqual({ activeChildCount: 7 });
    const completed = await completeTaskById(call, root, true);
    expect(completed.completedChildIds).toEqual(ids.slice(1));
    const undo = (completedChildIds: string[]) => call("POST", `/tasks/${root.id}/undo-completion`, {
      revision: completed.task.revision, completedChildIds,
    });
    await failure(await undo([leaf.id]), 409, "UNDO_UNAVAILABLE");
    expect(await payload(await undo(completed.completedChildIds)))
      .toMatchObject({ reopenedChildIds: ids.slice(1), task: { status: "active" } });
    expect((await page(call, project.id)).tasks.map(({ id }) => id)).toEqual(ids);
    expect(await getTaskById(call, alreadyCompleted.task.id)).toMatchObject({ status: "completed" });

    await completeTaskById(call, await getTaskById(call, root.id), true);
    const closedLeaf = await getTaskById(call, leaf.id);
    await payload(await call("POST", `/tasks/${leaf.id}/reopen`, { revision: closedLeaf.revision }));
    expect((await page(call, project.id)).tasks.map(({ id }) => id)).toEqual(ids);
    const reopened = await getTaskById(call, root.id);
    const url = `/tasks/${root.id}?revision=${reopened.revision}`;
    expect((await failure(await call("DELETE", url), 409, "HAS_CHILDREN")).details).toEqual({ childCount: 8 });
    expect((await call("DELETE", `${url}&withChildren=true`)).status).toBe(204);
    expect((await page(call, project.id, "?includeCompleted=true")).tasks).toEqual([]);
  });

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

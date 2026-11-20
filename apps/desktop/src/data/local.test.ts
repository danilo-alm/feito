import { describe, expect, it } from "vitest";
import type { Navigation, ProjectPage, SearchResult, TaskDetail, TaskMutation, TodayView } from "@feito/core/types";
import { handleLocal, newWorkspace, type LocalRequest } from "./local";

describe("espaço local do Feito", () => {
  it("grava subtarefas e etiquetas com os mesmos DTOs das telas", async () => {
    let workspace = newWorkspace();
    async function run<T>(request: LocalRequest) {
      const response = await handleLocal(workspace, request);
      expect(response.status).toBeLessThan(400);
      workspace = response.workspace;
      return response.body as T;
    }

    const { id: projectId } = await run<{ id: string }>({ method: "POST", path: "/projects", body: { name: "Casa" } });
    const { id: sectionId } = await run<{ id: string }>({
      method: "POST", path: `/projects/${projectId}/sections`, body: { name: "Manutenção" },
    });
    const { id: labelId } = await run<{ id: string }>({ method: "POST", path: "/labels", body: { name: "Compras" } });
    const parent = await run<TaskDetail>({ method: "POST", path: "/tasks", body: { projectId, sectionId, title: "Arrumar cozinha" } });
    const dueDate = (await run<TodayView>({ method: "GET", path: "/views/today" })).referenceDate;
    const child = await run<TaskMutation<TaskDetail>>({
      method: "POST", path: "/tasks", taskChanges: true, revision: 14,
      body: { projectId, sectionId, parentId: parent.id, title: "Comprar lâmpada", dueDate, labelIds: [labelId] },
    });
    expect(child.changes.revision).toBe(15);
    expect(child.changes.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ after: expect.objectContaining({ id: parent.id, childIds: [child.result.id] }) }),
    ]));
    expect((await run<ProjectPage>({ method: "GET", path: `/projects/${projectId}` })).tasks.map(({ id }) => id))
      .toEqual([parent.id, child.result.id]);
    expect((await run<Navigation>({ method: "GET", path: "/navigation" })).labels[0].activeCount).toBe(1);
    expect((await run<TodayView>({ method: "GET", path: "/views/today" })).today.map(({ id }) => id))
      .toEqual([child.result.id]);
    expect((await run<SearchResult>({ method: "POST", path: "/search", body: { text: "lampada" } })).results.map(({ id }) => id))
      .toEqual([child.result.id]);
  });

  it("reaplica uma criação e uma conclusão recorrente com os mesmos IDs e instante", async () => {
    const workspace = newWorkspace();
    const authoredAt = "2026-11-12T12:00:00Z";
    const create = {
      method: "POST", path: "/tasks", authoredAt,
      body: { title: "Regar as plantas", recurrence: { frequency: "daily" }, dueDate: "2026-11-12" },
    };
    const created = await handleLocal(workspace, create);
    const task = created.body as TaskDetail;
    const replayedCreate = await handleLocal(workspace, {
      ...create, body: created.operationBody, generatedIds: created.generatedIds, replay: true,
    });
    expect(created.generatedIds).toEqual([task.id, task.occurrenceId]);
    expect(replayedCreate.workspace).toEqual(created.workspace);

    const complete = {
      method: "POST", path: `/tasks/${task.id}/complete`, authoredAt,
      body: { revision: task.revision, occurrenceId: task.occurrenceId },
    };
    const completed = await handleLocal(created.workspace, complete);
    expect(completed.workspace.occurrences[0].data).toMatchObject({
      completedAt: authoredAt, nextOccurrenceId: completed.generatedIds?.[0],
    });
    const replayedComplete = await handleLocal(created.workspace, {
      ...complete, body: { ...complete.body, revision: 900 }, generatedIds: completed.generatedIds, replay: true,
    });
    expect(replayedComplete.workspace).toEqual(completed.workspace);

    const acknowledged = await handleLocal(completed.workspace, { ...complete, replay: true });
    expect(acknowledged.body).toMatchObject({ alreadyProcessed: true });
    expect(acknowledged.workspace).toEqual(completed.workspace);
  });

  it("preserva a cópia confirmada quando o servidor aceitou a criação e a resposta se perdeu", async () => {
    const request = { method: "POST", path: "/projects", body: { name: "Casa" } };
    const created = await handleLocal(newWorkspace(), request);
    const { id, revision } = created.body as { id: string; revision: number };
    const changed = await handleLocal(created.workspace, {
      method: "PATCH", path: `/projects/${id}`, body: { revision, name: "Casa nova" },
    });
    const replay = await handleLocal(changed.workspace, {
      ...request, replay: true, generatedIds: created.generatedIds,
    });
    expect(replay.status).toBe(409);
    expect(replay.workspace.projects.find((item) => item.id === id)?.data.name).toBe("Casa nova");
    expect(replay.workspace).toBe(changed.workspace);
  });

  it("mantém a base intacta quando a tarefa já foi excluída", async () => {
    const workspace = newWorkspace();
    const result = await handleLocal(workspace, {
      method: "PATCH", path: "/tasks/7ff03b17-804d-4dab-b405-86aa4be47285",
      body: { revision: 1, title: "Alteração antiga" }, replay: true,
    });
    expect(result.status).toBe(404);
    expect(result.workspace).toBe(workspace);
  });
});

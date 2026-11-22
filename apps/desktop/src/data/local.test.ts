import { defaultPreferences } from "@feito/core/domain/preferences";
import { describe, expect, it } from "vitest";
import { exportLocalWorkspace, localDestinationIsEmpty, restoreLocalWorkspace } from "@feito/core/portability/local";
import { parseDocument } from "@feito/core/portability/validate";
import { downloadReplica, reconcileReplica, synchronizeReplica } from "@feito/core/product/replica";
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

  it("restaura um backup local com subtarefas, etiquetas, preferências e ocorrências", async () => {
    let workspace = newWorkspace();
    async function run<T>(request: LocalRequest) {
      const response = await handleLocal(workspace, request);
      expect(response.status).toBeLessThan(400);
      workspace = response.workspace;
      return response.body as T;
    }

    await run({ method: "PATCH", path: "/preferences", body: { theme: "dark", timezone: "America/Sao_Paulo" } });
    const { id: projectId } = await run<{ id: string }>({ method: "POST", path: "/projects", body: { name: "Casa" } });
    const { id: sectionId } = await run<{ id: string }>({
      method: "POST", path: `/projects/${projectId}/sections`, body: { name: "Manutenção" },
    });
    const { id: labelId } = await run<{ id: string }>({ method: "POST", path: "/labels", body: { name: "Compras" } });
    const { id: parentId } = await run<TaskDetail>({
      method: "POST", path: "/tasks", body: { projectId, sectionId, title: "Arrumar cozinha" },
    });
    await run({
      method: "POST", path: "/tasks",
      body: { projectId, sectionId, parentId, title: "Comprar lâmpada", labelIds: [labelId] },
    });
    const authoredAt = "2026-11-12T12:00:00Z";
    const recurring = await run<TaskDetail>({
      method: "POST", path: "/tasks", authoredAt,
      body: { title: "Regar as plantas", recurrence: { frequency: "daily" }, dueDate: "2026-11-12" },
    });
    await run({
      method: "POST", path: `/tasks/${recurring.id}/complete`, authoredAt,
      body: { revision: recurring.revision, occurrenceId: recurring.occurrenceId },
    });

    const { document } = exportLocalWorkspace(workspace);
    const parsed = parseDocument(new TextEncoder().encode(JSON.stringify(document)));
    expect(parsed.errors).toEqual([]);
    const destination = newWorkspace();
    expect(localDestinationIsEmpty(destination)).toBe(true);
    expect(localDestinationIsEmpty({ ...destination, preferences: { ...destination.preferences, locale: "pt-BR" } })).toBe(true);
    const legacyDestination = structuredClone(destination);
    delete legacyDestination.preferences.locale;
    expect(localDestinationIsEmpty(legacyDestination)).toBe(true);
    const restored = restoreLocalWorkspace(destination, parsed.document!);
    expect(restored.projects[0].id).toBe(destination.projects[0].id);
    expect(restored.tasks.map(({ id }) => id)).not.toContain(recurring.id);
    expect(exportLocalWorkspace(restored).document).toEqual({ ...document, exportedAt: expect.any(String) });
    expect(() => restoreLocalWorkspace(restored, document)).toThrow(expect.objectContaining({ code: "DESTINATION_NOT_EMPTY" }));
    expect(localDestinationIsEmpty({ ...destination, preferences: workspace.preferences })).toBe(false);
  });
});

describe("réplica compartilhada", () => {
  const user = { id: "57c8cdab-838a-4538-a3ef-6b3933aff16b", email: "feito@example.test" };

  it("recusa leitura e envio quando o servidor autentica outra conta", async () => {
    const workspace = newWorkspace();
    const reply = { status: 200, body: { user, workspace, cursor: 5 } };
    const request = async () => reply;
    await expect(downloadReplica(request, "outra-conta")).rejects.toMatchObject({ state: "login", identityChanged: true });
    const replica = await downloadReplica(request, user.id);
    const sends: string[] = [];
    await expect(synchronizeReplica({ ...replica, user: { ...user, id: "outra-conta" } }, {
      request: async (method) => { sends.push(method); return reply; },
      reconcile: async () => { throw new Error("A réplica de outra conta foi aceita."); },
    })).rejects.toMatchObject({ state: "login", identityChanged: true });
    expect(sends).toEqual(["GET"]);
  });

  it("recusa mudanças incrementais calculadas a partir de uma cópia anterior", async () => {
    const workspace = newWorkspace();
    const replica = await downloadReplica(async () => ({ status: 200, body: { user, workspace, cursor: 5 } }));
    await expect(reconcileReplica(replica, {
      remote: { cursor: 6, workspace: null, user, changes: { preferences: { theme: "dark", timezone: "America/Maceio" } } },
      fromCursor: 4,
    })).rejects.toMatchObject({ state: "error" });
    expect(replica.working.preferences.theme).toBe("system");
  });

  it("aproveita o recibo de uma revisão já persistida por outra aba", async () => {
    const workspace = newWorkspace();
    const replica = await downloadReplica(async () => ({ status: 200, body: { user, workspace, cursor: 5 } }));
    const id = globalThis.crypto.randomUUID();
    const pending = [{ id, method: "PATCH", path: "/preferences", authoredAt: "2026-11-12T12:00:00Z" }];
    const updated = await reconcileReplica({ ...replica, pending }, {
      remote: { cursor: 5, workspace: null, user, changes: { preferences: { theme: "dark", timezone: "America/Maceio" } } },
      fromCursor: 4,
      removed: new Set([id]),
    });
    expect(updated.confirmed).toBe(workspace);
    expect(updated.working.preferences.theme).toBe("system");
    expect(updated.pending).toEqual([]);
  });
});

describe("preferência de idioma", () => {
  it("preserva idioma em patches parciais, backup e restauração de documentos antigos", async () => {
    const workspace = newWorkspace();
    expect(workspace.preferences.locale).toBe("en");
    const changed = await handleLocal(workspace, { method: "PATCH", path: "/preferences", body: { locale: "pt-BR" } });
    expect(changed.status).toBe(200);
    expect(changed.workspace.preferences).toMatchObject({ locale: "pt-BR", theme: "system" });
    const theme = await handleLocal(changed.workspace, { method: "PATCH", path: "/preferences", body: { theme: "dark" } });
    expect(theme.workspace.preferences).toMatchObject({ locale: "pt-BR", theme: "dark" });
    const { document } = exportLocalWorkspace(theme.workspace);
    expect(restoreLocalWorkspace(newWorkspace(), document).preferences.locale).toBe("pt-BR");
    const legacy = structuredClone(document);
    delete legacy.preferences.locale;
    const parsed = parseDocument(new TextEncoder().encode(JSON.stringify(legacy)));
    expect(parsed.errors).toEqual([]);
    const restored = restoreLocalWorkspace(newWorkspace(), parsed.document!);
    expect(restored.preferences.locale ?? defaultPreferences.locale).toBe("en");
    for (const locale of ["es", "pt-PT", "fr", "it", "de"]) {
      const saved = await handleLocal(workspace, { method: "PATCH", path: "/preferences", body: { locale } });
      expect(saved.status).toBe(200);
      expect(saved.workspace.preferences.locale).toBe(locale);
    }
    for (const locale of ["es-ES", "xx", ""]) {
      const invalid = await handleLocal(workspace, { method: "PATCH", path: "/preferences", body: { locale } });
      expect(invalid.status).toBe(422);
    }
  });
});

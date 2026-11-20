import { describe, expect, it } from "vitest";
import type { CompleteResponse, ReopenResponse, TaskDetail, TaskMutation } from "@/client/types";
import { accountFixture, failure, getTaskById, newLabel, newProject, newSection, newTask, page, payload } from "./product-client";

const projection = { headers: { "X-Feito-Task-Changes": "1" } };

describe("committed task projection changes", () => {
  it("persists anchored creation and duplication in single writes and returns the official order", async () => {
    const call = await accountFixture();
    const project = await newProject(call);
    const section = await newSection(call, project.id);
    const label = await newLabel(call, "Planejamento");
    const first = await newTask(call, "Primeira", { projectId: project.id, sectionId: section.id });
    const last = await newTask(call, "Última", { projectId: project.id, sectionId: section.id });

    const created = await payload<TaskMutation<TaskDetail>>(await call("POST", "/tasks", {
      title: "  Intermediária  ", description: "Introdução\nDescrição completa",
      projectId: project.id, sectionId: section.id, afterId: first.id, labelIds: [label.id],
    }, projection), 201);
    expect(created.result).toMatchObject({ title: "Intermediária", sectionId: section.id, revision: 1 });
    expect(created.changes.rows).toContainEqual(expect.objectContaining({
      after: expect.objectContaining({ id: last.id, revision: last.revision + 1 }),
    }));
    expect(created.changes.groups).toEqual([
      expect.objectContaining({ sectionId: section.id, orderedIds: [first.id, created.result.id, last.id] }),
    ]);

    const duplicated = await payload<TaskMutation<TaskDetail>>(
      await call("POST", `/tasks/${created.result.id}/duplicate`, undefined, projection), 201,
    );
    expect(duplicated.changes.revision).toBe(created.changes.revision + 1);
    expect(duplicated.result).toMatchObject({
      title: created.result.title, description: created.result.description,
      projectId: project.id, sectionId: section.id, labels: [{ id: label.id }], children: [],
    });
    const ordered = [first.id, created.result.id, duplicated.result.id, last.id];
    expect(duplicated.changes.groups?.[0].orderedIds).toEqual(ordered);
    expect((await page(call, project.id)).groups[1].rootIds).toEqual(ordered);

    const other = await accountFixture();
    await failure(await other("POST", `/tasks/${created.result.id}/duplicate`, undefined, projection), 404, "NOT_FOUND");
  });

  it("returns cascade effects for completion, reopening a descendant, moving and deletion", async () => {
    const call = await accountFixture();
    const project = await newProject(call);
    const destination = await newProject(call, "Destino");
    const parent = await newTask(call, "Tarefa", { projectId: project.id });
    const child = await newTask(call, "Subtarefa", { parentId: parent.id });
    const leaf = await newTask(call, "Neta", { parentId: child.id });
    const completed = await payload<TaskMutation<CompleteResponse>>(await call("POST", `/tasks/${parent.id}/complete`, {
      revision: parent.revision, includeChildren: true,
    }, projection));
    expect(completed.changes.rows.map(({ after }) => [after!.id, after!.status])).toEqual(expect.arrayContaining([
      [parent.id, "completed"], [child.id, "completed"], [leaf.id, "completed"],
    ]));

    const completedLeaf = completed.changes.rows.find(({ after }) => after?.id === leaf.id)!.after!;
    const reopened = await payload<TaskMutation<ReopenResponse>>(await call("POST", `/tasks/${leaf.id}/reopen`, {
      revision: completedLeaf.revision,
    }, projection));
    expect(reopened.changes.rows.map(({ after }) => [after!.id, after!.status])).toEqual(expect.arrayContaining([
      [parent.id, "active"], [child.id, "active"], [leaf.id, "active"],
    ]));

    const latest = await getTaskById(call, parent.id);
    await failure(await call("PATCH", `/tasks/${parent.id}`, { revision: parent.revision, title: "Conflito" }, projection),
      409, "REVISION_CONFLICT");
    const moved = await payload<TaskMutation<TaskDetail>>(await call("PATCH", `/tasks/${parent.id}`, {
      revision: latest.revision, destination: { projectId: destination.id, sectionId: null },
    }, projection));
    for (const id of [parent.id, child.id, leaf.id]) {
      expect(moved.changes.rows.find(({ after }) => after?.id === id)).toMatchObject({
        before: { projectId: project.id }, after: { projectId: destination.id },
      });
    }
    const removed = await payload<TaskMutation<null>>(await call(
      "DELETE", `/tasks/${parent.id}?revision=${moved.result.revision}&withChildren=true`, undefined, projection,
    ));
    expect(removed.result).toBeNull();
    expect(removed.changes.rows.map(({ before }) => before!.id).sort()).toEqual([parent.id, child.id, leaf.id].sort());
    expect(removed.changes.rows.every(({ after }) => !after)).toBe(true);
    expect((await page(call, destination.id)).tasks).toEqual([]);
  });
});

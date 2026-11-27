import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defaultPreferences } from "@feito/core/domain/preferences";
import { documentType, type PortableDocument } from "@/server/portability/document";
import { checkPreviewToken, fileDigest, makePreviewToken } from "@/server/portability/token";
import { parseDocument } from "@/server/portability/validate";
import { defaultsForView } from "@feito/core/validation/product";

function emptyDocument() {
  return {
    type: documentType,
    schemaVersion: 1,
    exportedAt: "2026-11-17T12:00:00Z",
    preferences: defaultPreferences,
    projects: [{ id: "inbox", isInbox: true, name: "Caixa de entrada", description: "", color: null, icon: "hash", archived: false,
      view: defaultsForView, createdAt: "1970-01-01T00:00:00Z" }],
    sections: [], tasks: [], labels: [], taskLabels: [], occurrences: [],
  } satisfies PortableDocument;
}

const parse = (value: unknown) => parseDocument(Buffer.from(JSON.stringify(value)));

describe("portable document", () => {
  it("accepts v1 and reports an unknown version by path", () => {
    const file = emptyDocument();
    expect(parse(file)).toEqual({ schemaVersion: 1, document: file, errors: [] });
    expect(parse({ ...file, schemaVersion: 3 })).toMatchObject({
      schemaVersion: 3, document: null, errors: [{ path: "schemaVersion" }],
    });
    // Version 2 adds comments; version 1 files have none.
    expect(parse({ ...file, schemaVersion: 2, comments: [] })).toMatchObject({ schemaVersion: 2, errors: [] });
    expect(parse({ ...file, schemaVersion: 2 }).errors.map(({ path }) => path)).toEqual(["comments"]);
    expect(parse({ ...file, comments: [] }).errors.map(({ path }) => path)).toEqual(["comments"]);
    expect(parse({ ...file, tenantId: randomUUID() }).document).toBeNull();
  });

  it("rejects duplicate IDs and labels, broken links, and sections in Inbox", () => {
    const doc = emptyDocument();
    const invalid = {
      ...doc,
      sections: [{ id: "inbox", projectId: "inbox", name: "Seção", position: 0 }],
      labels: [{ id: "label1", name: "Café" }, { id: "label2", name: "CAFE\u0301" }],
      taskLabels: [{ taskId: "missing", labelId: "label1" }],
    };
    const result = parse(invalid);
    expect(result.document).toBeNull();
    expect(result.errors.map(({ path }) => path)).toEqual(expect.arrayContaining([
      "sections.0.id", "sections.0.projectId", "labels.1.name", "taskLabels.0.taskId",
    ]));
  });

  it("accepts Calendar and Table on the Inbox but not Board", () => {
    const file = emptyDocument();
    const inboxWith = (layout: string) => ({ ...file, projects: [{ ...file.projects[0], view: { ...defaultsForView, layout } }] });
    for (const layout of ["calendar", "table"]) expect(parse(inboxWith(layout)).errors).toEqual([]);
    expect(parse(inboxWith("board")).errors.map(({ path }) => path)).toContain("projects");
  });

  it("keeps parent projects through export and restore and rejects parents outside the document", async () => {
    const { handleLocal, newWorkspace } = await import("@feito/core/product/local-executor");
    const { exportLocalWorkspace, restoreLocalWorkspace } = await import("@feito/core/portability/local");
    let workspace = newWorkspace();
    const create = async (body: unknown) => {
      const result = await handleLocal(workspace, { method: "POST", path: "/projects", body });
      workspace = result.workspace;
      return result.body as { id: string };
    };
    const parent = await create({ name: "Casa" });
    await create({ name: "Cozinha", parentId: parent.id });
    const file = exportLocalWorkspace(workspace).document;
    const exported = file.projects.find((project) => project.name === "Cozinha")!;
    expect(exported.parentId).toBe(file.projects.find((project) => project.name === "Casa")!.id);
    expect(parse(file).errors).toEqual([]);

    const restored = restoreLocalWorkspace(newWorkspace(), file);
    const ids = new Map(restored.projects.map((project) => [project.data.name, project.id]));
    expect(restored.projects.find((project) => project.id === ids.get("Cozinha"))!.data.parentId).toBe(ids.get("Casa"));

    for (const parentId of ["missing", file.projects.find((project) => project.isInbox)!.id, exported.id]) {
      const broken = { ...file, projects: file.projects.map((project) => project === exported ? { ...project, parentId } : project) };
      expect(parse(broken).errors.map(({ path }) => path)).toContain(`projects.${file.projects.indexOf(exported)}.parentId`);
    }
  });

  it("keeps comments through export and restore and rejects comments outside the document", async () => {
    const { handleLocal, newWorkspace } = await import("@feito/core/product/local-executor");
    const { exportLocalWorkspace, restoreLocalWorkspace } = await import("@feito/core/portability/local");
    let workspace = newWorkspace();
    const send = async (path: string, body: unknown, authoredAt: string, method = "POST") => {
      const result = await handleLocal(workspace, { method, path, body, authoredAt });
      workspace = result.workspace;
      return result.body as { id: string };
    };
    expect(exportLocalWorkspace(workspace).document).toMatchObject({ schemaVersion: 2, comments: [] });
    const task = await send("/tasks", { title: "Comentada" }, "2026-11-17T12:00:00Z");
    const later = await send(`/tasks/${task.id}/comments`, { body: "Segundo" }, "2026-11-17T12:10:00Z");
    await send(`/tasks/${task.id}/comments`, { body: "Primeiro" }, "2026-11-17T12:05:00Z");
    await send(`/comments/${later.id}`, { revision: 1, body: "Segundo, editado" }, "2026-11-17T12:20:00Z", "PATCH");

    const file = exportLocalWorkspace(workspace).document;
    const exportedTask = file.tasks[0].id;
    expect(file.comments).toEqual([
      { taskId: exportedTask, body: "Primeiro", createdAt: "2026-11-17T12:05:00Z", editedAt: null },
      { taskId: exportedTask, body: "Segundo, editado", createdAt: "2026-11-17T12:10:00Z", editedAt: "2026-11-17T12:20:00Z" },
    ]);
    expect(parse(file).errors).toEqual([]);
    const restored = restoreLocalWorkspace(newWorkspace(), file);
    expect(restored.comments!.map(({ taskId, revision, data }) => ({ taskId, revision, body: data.body })))
      .toEqual([
        { taskId: restored.tasks[0].id, revision: 1, body: "Primeiro" },
        { taskId: restored.tasks[0].id, revision: 1, body: "Segundo, editado" },
      ]);

    const broken = { ...file, comments: [{ ...file.comments![0], taskId: "missing" }, { ...file.comments![1], body: " " }] };
    expect(parse(broken).errors.map(({ path }) => path)).toEqual(["comments.1.body"]);
    expect(parse({ ...file, comments: [{ ...file.comments![0], taskId: "missing" }] }).errors.map(({ path }) => path))
      .toEqual(["comments.0.taskId"]);
  });

  it("defaults missing project and section descriptions in older v1 files", () => {
    const file = emptyDocument();
    const { description: _description, ...inbox } = file.projects[0];
    expect(parse({
      ...file,
      projects: [inbox, { ...inbox, id: "project", isInbox: false, name: "Casa" }],
      sections: [{ id: "section", projectId: "project", name: "Compras", position: 0 }],
    }).document).toMatchObject({
      projects: [{ description: "" }, { description: "" }],
      sections: [{ description: "" }],
    });
  });

  it("limits nesting and reported errors before validating relationships", () => {
    expect(parseDocument(Buffer.from("[".repeat(11) + "0" + "]".repeat(11))).errors[0].message)
      .toBe("Documento complexo demais.");
    expect(parse({ ...emptyDocument(), tasks: Array.from({ length: 1000 }, () => ({})) }).errors).toHaveLength(50);
    expect(parseDocument(Buffer.from([0xc0, 0x80]))).toMatchObject({ schemaVersion: null, document: null });
  });

  it("accepts deep task hierarchies and rejects cycles in parent references", () => {
    const tasks = Array.from({ length: 20 }, (_, depth): PortableDocument["tasks"][number] => ({
      id: `t${depth}`, parentId: depth ? `t${depth - 1}` : null, projectId: "inbox", sectionId: null,
      occurrenceId: null, title: `Tarefa ${depth}`, description: "", priority: 4, position: 0,
      createdAt: "2026-11-17T12:00:00Z", status: "active", completedAt: null, dueDate: null, dueTime: null, recurrenceRule: null,
    })).reverse();
    expect(parse({ ...emptyDocument(), tasks }).document?.tasks).toEqual(tasks);
    tasks.at(-1)!.parentId = tasks[0].id;
    expect(parse({ ...emptyDocument(), tasks }).errors).toEqual([
      { path: "tasks.0.parentId", message: "A hierarquia de tarefas contém um ciclo." },
    ]);
  });
});

describe("preview token", () => {
  it("authenticates the exact bytes, session, tenant and operation and expires after fifteen minutes", () => {
    const secret = randomBytes(32).toString("base64url");
    const binding = {
      tenantId: randomUUID(), sessionId: randomUUID(), operationId: randomUUID(), digest: fileDigest(Buffer.from("{}")),
    };
    const start = 1_792_000_000_000;
    const { previewToken, expiresAt } = makePreviewToken(secret, binding, start);
    expect(new Date(expiresAt).getTime()).toBe(start + 900_000);
    expect(() => checkPreviewToken(previewToken, secret, binding, start + 899_999)).not.toThrow();
    for (const field of ["tenantId", "sessionId", "operationId", "digest"] as const) {
      expect(() => checkPreviewToken(previewToken, secret, { ...binding, [field]: randomUUID() }, start))
        .toThrow(expect.objectContaining({ code: "IMPORT_INVALID" }));
    }
    expect(() => checkPreviewToken(previewToken, secret, binding, start + 900_000))
      .toThrow(expect.objectContaining({ code: "PREVIEW_EXPIRED" }));
  });
});

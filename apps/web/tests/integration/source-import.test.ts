import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { previewSourceImport } from "@/server/services/source-import";
import type { ImportCounts } from "@/validation/portability";
import { accountFixture, failure, nav, newLabel, newProject, newSection, newTask, page, payload, type Client } from "./product-client";

type Preview = Awaited<ReturnType<typeof previewSourceImport>>;
type Receipt = { operationId: string; summary: ImportCounts; projectIds?: string[] };

afterEach(() => vi.restoreAllMocks());

const fixture = (name: string) => readFileSync(new URL(`../fixtures/todoist/${name}`, import.meta.url), "utf8");
const HEADER = "TYPE,CONTENT,DESCRIPTION,ICON,IS_COLLAPSED,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG,REMINDER_TYPE,REMINDER_OFFSET,REMINDER_DATE,REMINDER_DATE_LANG";
const body = (...files: [string, string][]) => JSON.stringify({ files: files.map(([name, content]) => ({ name, content })) });
const into = (projectId: string, ...files: [string, string][]) =>
  JSON.stringify({ files: files.map(([name, content]) => ({ name, content })), projectId });

async function preview(call: Client, raw: string, source = "todoist") {
  const response = await call("POST", `/import/sources/${source}/preview`, undefined, { raw, headers: { "X-Operation-Id": randomUUID() } });
  return { response, operationId: response.headers.get("X-Operation-Id") };
}

function confirm(call: Client, raw: string, operationId: string, token: string) {
  return call("POST", "/import/sources/todoist/confirm", undefined, {
    raw, headers: { "X-Operation-Id": operationId, "X-Preview-Token": token },
  });
}

describe("Todoist import", () => {
  it("adds projects to an account with data, reuses labels and replays the receipt", async () => {
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(Temporal.Instant.from("2026-11-19T15:00:00Z"));
    const call = await accountFixture();
    expect((await call("PATCH", "/preferences", { timezone: "America/Sao_Paulo" })).status).toBe(200);
    await newTask(call, "Já existia");
    await newLabel(call, "Casa");

    const extra = `﻿${HEADER}\nmeta,view_style=board,,,,,,,,,,,,,,,,,,\ntask,Pão @casa @mercado,,,,2,1,,,every monday 8am,en,,,,,,,,,\n`
      + "task,Integral,,,,4,2,,,,,,,,,,,,,\nnote,Sem glúten,,,,,,,,,,,,,,,,,,\n";
    const raw = body(["Casa Nova.csv", fixture("casa-nova-datas-relativas.csv")], ["Mercado.csv", extra]);
    const first = await preview(call, raw);
    const inspected = await payload<Preview>(first.response);
    expect(inspected).toMatchObject({
      source: "todoist", errors: [], referenceDate: "2026-11-19",
      counts: { projects: 2, sections: 1, tasks: 18, labels: 1, archivedProjects: 0, completedTasks: 0, occurrences: 0 },
      projects: [
        { name: "Casa Nova", layout: "list", sections: 1, tasks: 16, subtasks: 0, dated: 2, recurring: 0 },
        { name: "Mercado", layout: "board", sections: 0, tasks: 1, subtasks: 1, dated: 1, recurring: 0 },
      ],
    });
    expect(inspected.warnings).toHaveLength(2);
    expect(inspected.previewToken).toBeTruthy();

    const [one, two] = await Promise.all([
      confirm(call, raw, first.operationId!, inspected.previewToken!),
      confirm(call, raw, first.operationId!, inspected.previewToken!),
    ]);
    const results = [await payload<Receipt>(one), await payload<Receipt>(two)];
    expect(results.filter((result) => result.projectIds)).toHaveLength(1);
    const fresh = results.find((result) => result.projectIds)!;
    expect(results.map(({ operationId, summary }) => ({ operationId, summary })))
      .toEqual([{ operationId: fresh.operationId, summary: fresh.summary }, { operationId: fresh.operationId, summary: fresh.summary }]);
    expect(await payload(await call("GET", `/import/operations/${fresh.operationId}`)))
      .toEqual({ operationId: fresh.operationId, summary: fresh.summary, status: "completed" });

    const navigation = await nav(call);
    expect(navigation.projects.map((project) => project.name)).toEqual(["Casa Nova", "Mercado"]);
    expect(navigation.labels.map((label) => label.name).sort()).toEqual(["Casa", "mercado"]);
    expect(navigation.inbox.activeCount).toBe(1);

    const house = await page(call, fresh.projectIds![0]);
    expect(house.tasks).toHaveLength(16);
    expect(house.tasks[0]).toMatchObject({ title: "Ligar para a companhia de luz", priority: 1, dueDate: "2026-11-20" });
    expect(house.sections.map((section) => section.name)).toEqual(["teste"]);

    const market = await page(call, fresh.projectIds![1]);
    expect(market.project.view.layout).toBe("board");
    const [bread, wholegrain] = market.tasks;
    expect(bread).toMatchObject({ title: "Pão", dueDate: "2026-11-23", dueTime: "08:00", recurrence: null, childIds: [wholegrain.id] });
    expect(bread.labels.map((label) => label.name).sort()).toEqual(["Casa", "mercado"]);
    expect(wholegrain).toMatchObject({ parentId: bread.id, descriptionExcerpt: "Comentários do Todoist:" });
  });

  it("imports a recurring root task", async () => {
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(Temporal.Instant.from("2026-11-19T15:00:00Z"));
    const call = await accountFixture();
    const raw = body(["Rotina.csv", `${HEADER}\ntask,Regar plantas,,,,4,1,,,toda segunda às 8h,pt_BR,,,,,,,,,\n`]);
    const first = await preview(call, raw);
    const inspected = await payload<Preview>(first.response);
    const result = await payload<Receipt>(await confirm(call, raw, first.operationId!, inspected.previewToken!));
    const [task] = (await page(call, result.projectIds![0])).tasks;
    expect(task).toMatchObject({ dueDate: "2026-11-23", dueTime: "08:00", recurrence: { frequency: "weekly" } });
    expect(task.occurrenceId).toBeTruthy();
  });

  it("appends tasks and sections to an existing project, flattens sections in Inbox and refuses archived projects", async () => {
    const call = await accountFixture();
    const project = await newProject(call, "Casa");
    const kept = await newSection(call, project.id, "Já existia");
    const first = await newTask(call, "Primeira", { projectId: project.id });
    const csv = `${HEADER}\ntask,Raiz importada,,,,,1,,,,,,,,,,,,,\nsection,Nova seção,,,,,,,,,,,,,,,,,,\ntask,Dentro da seção,,,,,1,,,,,,,,,,,,,\n`;
    const raw = into(project.id, ["Outro nome.csv", csv]);
    const started = await preview(call, raw);
    const inspected = await payload<Preview>(started.response);
    expect(inspected).toMatchObject({
      target: { id: project.id, name: "Casa" }, errors: [],
      counts: { projects: 0, sections: 1, tasks: 2 }, projects: [{ name: "Casa", tasks: 2, sections: 1 }],
    });
    const result = await payload<Receipt>(await confirm(call, raw, started.operationId!, inspected.previewToken!));
    expect(result.projectIds).toEqual([project.id]);
    const updated = await page(call, project.id);
    expect(updated.sections.map((section) => section.name)).toEqual(["Já existia", "Nova seção"]);
    expect(updated.sections[0].id).toBe(kept.id);
    expect(updated.tasks.map((task) => task.title)).toEqual(["Primeira", "Raiz importada", "Dentro da seção"]);
    expect(updated.tasks[0].id).toBe(first.id);
    expect((await nav(call)).projects.map((item) => item.name)).toEqual(["Casa"]);

    const inboxId = (await nav(call)).inbox.projectId;
    const toInbox = into(inboxId, ["x.csv", csv]);
    const inboxPreview = await payload<Preview>((await preview(call, toInbox)).response);
    expect(inboxPreview).toMatchObject({ counts: { sections: 0, tasks: 2 } });
    expect(inboxPreview.warnings).toEqual([expect.stringContaining("Entrada não tem seções")]);

    expect((await call("POST", `/projects/${project.id}/archive`, { revision: project.revision })).status).toBe(200);
    expect(await payload<Receipt>(await confirm(call, raw, started.operationId!, inspected.previewToken!)))
      .toEqual({ operationId: result.operationId, summary: result.summary });
    expect((await page(call, project.id)).tasks.map((task) => task.id)).toEqual(updated.tasks.map((task) => task.id));
    await failure((await preview(call, raw)).response, 409, "PROJECT_ARCHIVED");
    await failure((await preview(call, into(randomUUID(), ["x.csv", csv]))).response, 404, "NOT_FOUND");
  });

  it("reports invalid files without a token and rejects unknown sources and tampered bodies", async () => {
    const call = await accountFixture();
    const invalid = await payload<Preview>((await preview(call, body(["x.csv", "nome,valor\n1,2\n"]))).response);
    expect(invalid).toMatchObject({ counts: null, previewToken: null, errors: [{ path: "x.csv" }] });
    await failure((await preview(call, body(["x.csv", HEADER]), "asana")).response, 404, "NOT_FOUND");
    await failure((await preview(call, "{}")).response, 422, "IMPORT_INVALID");

    const raw = body(["A.csv", `${HEADER}\ntask,Um,,,,,1,,,,,,,,,,,,,\n`]);
    const first = await preview(call, raw);
    const { previewToken } = await payload<Preview>(first.response);
    await failure(await confirm(call, raw.replace("Um", "Dois"), first.operationId!, previewToken!), 422, "IMPORT_INVALID");
  });

  it("rejects malformed Unicode in an uploaded file before creating any project", async () => {
    const call = await accountFixture();
    const invalid = body(["Ruim.csv", `${HEADER}\ntask,Título incompleto \uD800,,,,,1,,,,,,,,,,,,,\n`]);
    const attempt = await preview(call, invalid);
    expect(attempt.operationId).toBeNull();
    await failure(attempt.response, 422, "IMPORT_INVALID");
    expect((await nav(call)).projects).toEqual([]);
  });
});

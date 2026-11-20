import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { previewSourceImport } from "@/server/services/source-import";
import {
  accountFixture, completeTaskById, failure, newLabel, newProject, newSection, newTask, page, payload, type Client,
} from "./product-client";

afterEach(() => vi.restoreAllMocks());

type Preview = Awaited<ReturnType<typeof previewSourceImport>>;

async function download(call: Client, projectId: string, query: string) {
  const response = await call("GET", `/projects/${projectId}/export?${query}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return { text: new TextDecoder().decode(bytes), disposition: response.headers.get("Content-Disposition") };
}

async function reimport(call: Client, name: string, content: string) {
  const raw = JSON.stringify({ files: [{ name, content }] });
  const started = await call("POST", "/import/sources/todoist/preview", undefined, { raw, headers: { "X-Operation-Id": randomUUID() } });
  const preview = await payload<Preview>(started);
  expect(preview.errors).toEqual([]);
  const confirmed = await call("POST", "/import/sources/todoist/confirm", undefined, {
    raw, headers: { "X-Operation-Id": started.headers.get("X-Operation-Id")!, "X-Preview-Token": preview.previewToken! },
  });
  return { preview, result: await payload<{ projectIds: string[] }>(confirmed) };
}

const shape = (tasks: Awaited<ReturnType<typeof page>>["tasks"]) => tasks.map((task) => ({
  title: task.title, priority: task.priority, dueDate: task.dueDate, dueTime: task.dueTime,
  recurrence: task.recurrence, labels: task.labels.map((label) => label.name).sort(), parent: !!task.parentId,
  childCount: task.childIds.length,
}));

describe("project export", () => {
  it("exports a project as a Todoist CSV that imports back with the same content", async () => {
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(Temporal.Instant.from("2026-11-19T15:00:00Z"));
    const call = await accountFixture();
    expect((await call("PATCH", "/preferences", { timezone: "America/Sao_Paulo" })).status).toBe(200);
    const project = await newProject(call, "Casa: reforma");
    expect((await call("PATCH", `/projects/${project.id}/view`, { layout: "board" })).status).toBe(200);
    const label = await newLabel(call, "Fim de semana");
    const plain = await newLabel(call, "casa");
    const parent = await newTask(call, "Pintar, \"lixar\" antes", {
      projectId: project.id, priority: 1, dueDate: "2026-11-20", dueTime: "09:30",
      description: "Linha 1\nLinha 2", labelIds: [label.id, plain.id],
    });
    const child = await newTask(call, "Comprar tinta", { parentId: parent.id, dueDate: "2027-01-05" });
    await newTask(call, "Conferir estoque", { parentId: child.id });
    const done = await newTask(call, "Já feita", { projectId: project.id });
    await completeTaskById(call, done);
    const section = await newSection(call, project.id, "Jardim");
    await newTask(call, "Regar", { projectId: project.id, sectionId: section.id, dueDate: "2026-11-23", recurrence: { frequency: "weekly", time: "07:00" } });
    await newTask(call, "Adubar", { projectId: project.id, sectionId: section.id, dueDate: "2026-11-30", recurrence: { frequency: "monthly" } });
    await newTask(call, "Podar", { projectId: project.id, sectionId: section.id, priority: 3 });

    const { text, disposition } = await download(call, project.id, "format=todoist");
    expect(disposition).toBe(`attachment; filename="Casa_ reforma.csv"; filename*=UTF-8''Casa_%20reforma.csv`);
    const lines = text.split("\n");
    expect(lines[0]).toBe("TYPE,CONTENT,DESCRIPTION,ICON,IS_COLLAPSED,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG,REMINDER_TYPE,REMINDER_OFFSET,REMINDER_DATE,REMINDER_DATE_LANG");
    expect(lines[1]).toBe("meta,view_style=board,,,,,,,,,,,,,,,,,,");
    expect(text).toMatch(/task,"Pintar, ""lixar"" antes (?:@Fim_de_semana @casa|@casa @Fim_de_semana)","Linha 1\nLinha 2",,,1,1,,,Nov 20 2026 at 09:30,en,America\/Sao_Paulo/);
    expect(text).toContain("task,Comprar tinta,,,,4,2,,,Jan 5 2027,en,");
    expect(text).toContain("task,Conferir estoque,,,,4,3,");
    expect(text).toContain("section,Jardim,,,False,");
    expect(text).toContain("task,Regar,,,,4,1,,,every monday at 07:00,en,");
    expect(text).toContain("task,Adubar,,,,4,1,,,every 30th,en,");
    expect(text).not.toContain("Já feita");

    const relative = await download(call, project.id, "format=todoist&relativeDates=true");
    expect(relative.text).toContain(",tomorrow at 09:30,en,");
    expect(relative.text).toContain(",in 47 days,en,");

    const original = await page(call, project.id);
    const { preview, result } = await reimport(call, "Cópia.csv", text);
    expect(preview.warnings).toEqual([]);
    const copy = await page(call, result.projectIds[0]);
    expect(copy.project.view.layout).toBe("board");
    expect(copy.sections.map((item) => item.name)).toEqual(["Jardim"]);
    expect(shape(copy.tasks)).toEqual(shape(original.tasks).map((task) =>
      task.labels.includes("Fim de semana") ? { ...task, labels: ["Fim_de_semana", "casa"] } : task));
    expect(copy.tasks[0].descriptionExcerpt).toBe("Linha 1");
    expect(copy.tasks[2].parentId).toBe(copy.tasks[1].id);
  });

  it("rejects unknown formats, options and projects", async () => {
    const call = await accountFixture();
    const project = await newProject(call);
    await failure(await call("GET", `/projects/${project.id}/export?format=asana`), 422, "VALIDATION_FAILED");
    await failure(await call("GET", `/projects/${project.id}/export?format=todoist&colors=true`), 422, "VALIDATION_FAILED");
    await failure(await call("GET", `/projects/${project.id}/export?format=todoist&format=todoist`), 422, "VALIDATION_FAILED");
    await failure(await call("GET", `/projects/${randomUUID()}/export?format=todoist`), 404, "NOT_FOUND");
  });

  it("round-trips long relative dates and years with leading zeroes", async () => {
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(Temporal.Instant.from("2026-11-19T15:00:00Z"));
    const call = await accountFixture();
    const project = await newProject(call, "Datas distantes");
    await newTask(call, "Antiga", { projectId: project.id, dueDate: "0099-01-03" });
    await newTask(call, "Futura", { projectId: project.id, dueDate: "2029-08-15", dueTime: "14:30" });

    const relative = await download(call, project.id, "format=todoist&relativeDates=true");
    expect(relative.text).toContain(",Jan 3 0099,en,");
    expect(relative.text).toContain(",in 1000 days at 14:30,en,");
    const { preview, result } = await reimport(call, "Datas.csv", relative.text);
    expect(preview.warnings).toEqual([]);
    expect(shape((await page(call, result.projectIds[0])).tasks)).toEqual(shape((await page(call, project.id)).tasks));
  });
});

import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withProductReader } from "@/server/db/product-crypto";
import { completedOccurrences } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import type { getToday, getUpcoming } from "@/server/services/agenda";
import type { searchTasks } from "@/server/services/search";
import type { completeTask } from "@/server/services/tasks";
import { completedOccurrencePayload, type RecurrenceRule } from "@/validation/product";
import {
  accountFixture, completeTaskById, failure, getTaskById, nav, newLabel, newProject, newSection,
  newTask, payload, productAccess, type Client, type Task,
} from "./product-client";

type Today = Awaited<ReturnType<typeof getToday>>;
type Upcoming = Awaited<ReturnType<typeof getUpcoming>>;
type Search = Awaited<ReturnType<typeof searchTasks>>;
type Completion = Awaited<ReturnType<typeof completeTask>>;

afterEach(() => vi.restoreAllMocks());

function now(value: string) {
  return vi.spyOn(Temporal.Now, "instant").mockReturnValue(Temporal.Instant.from(value));
}

function setRule(call: Client, task: Task, frequency: RecurrenceRule["frequency"], anchorDate: string, time?: string) {
  return call("PUT", `/tasks/${task.id}/recurrence`, { revision: task.revision, frequency, anchorDate, time })
    .then((response) => payload<Task>(response));
}

function completeOccurrence(call: Client, task: Task) {
  return call("POST", `/tasks/${task.id}/complete`, { revision: task.revision, occurrenceId: task.occurrenceId })
    .then((response) => payload<Completion>(response));
}

function historyRows(call: Client, taskId: string) {
  const { db, tenantId } = productAccess(call);
  return withTenant(db, tenantId, (tx) => tx.select().from(completedOccurrences).where(eq(completedOccurrences.taskId, taskId)));
}

describe("recurring occurrences", () => {
  it("advances a late daily occurrence once across simultaneous submissions and records encrypted history", async () => {
    now("2026-11-17T14:15:00Z");
    const [call, other] = await Promise.all([accountFixture(), accountFixture()]);
    const task = await newTask(call, "Diária");
    const daily = await setRule(call, task, "daily", "2026-11-16", "09:30");
    expect(daily).toMatchObject({
      recurrenceRule: { frequency: "daily", anchorDate: "2026-11-16", nominalDate: "2026-11-16", time: "09:30" },
      dueDate: "2026-11-16", dueTime: "09:30",
    });
    await failure(await call("POST", `/tasks/${task.id}/complete`, { revision: daily.revision }), 422, "VALIDATION_FAILED");
    await failure(await call("POST", `/tasks/${task.id}/complete`, {
      revision: daily.revision, occurrenceId: randomUUID(),
    }), 409, "OCCURRENCE_STALE");
    await failure(await call("POST", `/tasks/${task.id}/complete`, {
      revision: task.revision, occurrenceId: daily.occurrenceId,
    }), 409, "REVISION_CONFLICT");

    const [a, b] = await Promise.all([completeOccurrence(call, daily), completeOccurrence(call, daily)]);
    expect([a.alreadyProcessed, b.alreadyProcessed].sort()).toEqual([false, true]);
    expect(a.task).toEqual(b.task);
    expect(a.task).toMatchObject({
      id: task.id, revision: daily.revision + 1, status: "active", completedAt: null,
      dueDate: "2026-11-18", dueTime: "09:30", recurrence: { frequency: "daily" },
    });
    expect(a.task.occurrenceId).not.toBe(daily.occurrenceId);
    expect(await completeOccurrence(call, daily)).toEqual({ ...a, alreadyProcessed: true });
    const rows = await historyRows(call, task.id);
    expect(rows).toHaveLength(1);
    const [stored] = rows;
    expect(stored.occurrenceId).toBe(daily.occurrenceId);
    expect(stored.ciphertext.includes(Buffer.from("2026-11-16"))).toBe(false);

    const { db, keys, tenantId } = productAccess(call);
    const decoded = await withTenant(db, tenantId, (tx) => withProductReader(tx, keys, tenantId, (read) =>
      read(stored, {
        ...stored, id: stored.occurrenceId, type: "completed_occurrence", links: [stored.taskId],
      }, completedOccurrencePayload)));
    expect(decoded).toEqual({
      nominalDate: "2026-11-16", dueDate: "2026-11-16", dueTime: "09:30", completedAt: "2026-11-17T14:15:00Z",
      nextOccurrenceId: a.task.occurrenceId,
    });
    expect(await historyRows(other, task.id)).toEqual([]);
    await failure(await other("POST", `/tasks/${task.id}/complete`, {
      revision: daily.revision, occurrenceId: daily.occurrenceId,
    }), 404, "NOT_FOUND");
    expect((await payload<Today>(await call("GET", "/views/today?includeCompleted=true"))).completedToday).toEqual([]);
  });

  it("preserves the nominal date and ID on a one-off reschedule and restores the weekly rule time", async () => {
    now("2026-11-15T18:30:00Z");
    const call = await accountFixture();
    const root = await newTask(call, "Semanal");
    const series = await setRule(call, root, "weekly", "2026-11-16", "14:30");
    const shifted = await payload<Task>(await call("PATCH", `/tasks/${root.id}`, {
      revision: series.revision, dueDate: "2026-11-15", dueTime: "06:00",
    }));
    expect(shifted).toMatchObject({
      occurrenceId: series.occurrenceId, dueDate: "2026-11-15", dueTime: "06:00",
      recurrenceRule: { nominalDate: "2026-11-16", time: "14:30" },
    });
    await failure(await call("PATCH", `/tasks/${root.id}`, { revision: shifted.revision, dueDate: null }),
      422, "VALIDATION_FAILED");
    const advanced = await completeOccurrence(call, shifted);
    expect(advanced.task).toMatchObject({ dueDate: "2026-11-23", dueTime: "14:30" });
    expect((await getTaskById(call, root.id)).recurrenceRule?.nominalDate).toBe("2026-11-23");
  });

  it("returns to the original day after February and preserves history across replacement and removal", async () => {
    const clock = now("2027-01-31T14:00:00Z");
    const call = await accountFixture();
    const task = await newTask(call, "Mensal", {
      dueDate: "2027-01-31", recurrence: { frequency: "monthly", time: "07:05" },
    });
    const february = await completeOccurrence(call, task);
    expect(february.task.dueDate).toBe("2027-02-28");
    clock.mockReturnValue(Temporal.Instant.from("2027-02-28T14:00:00Z"));
    const march = await completeOccurrence(call, await getTaskById(call, task.id));
    expect(march.task).toMatchObject({ dueDate: "2027-03-31", dueTime: "07:05" });
    const next = await setRule(call, await getTaskById(call, task.id), "daily", "2027-04-02");
    expect(next).toMatchObject({ dueDate: "2027-04-02", dueTime: null, recurrenceRule: { nominalDate: "2027-04-02" } });
    expect(next.occurrenceId).not.toBe(march.task.occurrenceId);
    await failure(await call("POST", `/tasks/${task.id}/complete`, {
      revision: next.revision, occurrenceId: march.task.occurrenceId,
    }), 409, "OCCURRENCE_STALE");

    const stopped = await payload<Task>(await call("DELETE", `/tasks/${task.id}/recurrence?revision=${next.revision}`));
    expect(stopped).toMatchObject({ occurrenceId: null, recurrenceRule: null, dueDate: "2027-04-02", dueTime: null });
    expect(await historyRows(call, task.id)).toHaveLength(2);
    expect(await completeOccurrence(call, task)).toMatchObject({
      alreadyProcessed: true, task: { occurrenceId: null, dueDate: "2027-04-02" },
    });
    expect((await call("DELETE", `/tasks/${task.id}?revision=${stopped.revision}`)).status).toBe(204);
    expect(await historyRows(call, task.id)).toEqual([]);
  });

  it("rejects recurrence for children, parents with children and completed tasks", async () => {
    const call = await accountFixture();
    const root = await newTask(call, "Pai");
    const child = await newTask(call, "Subtarefa", { parentId: root.id });
    for (const task of [root, child]) {
      await failure(await call("PUT", `/tasks/${task.id}/recurrence`, {
        revision: task.revision, frequency: "daily", anchorDate: "2026-11-17",
      }), 422, "RECURRENCE_NOT_ALLOWED");
    }
    const done = await completeTaskById(call, await newTask(call, "Concluída"));
    await failure(await call("PUT", `/tasks/${done.task.id}/recurrence`, {
      revision: done.task.revision, frequency: "daily", anchorDate: "2026-11-17",
    }), 409, "TASK_COMPLETED");
  });
});

describe("local agenda", () => {
  it("moves tasks to overdue at the profile's midnight and filters completions by local day", async () => {
    const clock = now("2026-11-17T02:59:59Z");
    const call = await accountFixture();
    const project = await newProject(call, "Ativo");
    const section = await newSection(call, project.id, "Seção de teste");
    const root = await newTask(call, "Pai", { projectId: project.id, sectionId: section.id });
    const child = await newTask(call, "Filha", { parentId: root.id, dueDate: "2026-11-16", dueTime: "09:00", priority: 2 });
    const first = await newTask(call, "Horário mais cedo", { dueDate: "2026-11-16", dueTime: "08:00", priority: 4 });
    const unTimed = await newTask(call, "Sem hora", { dueDate: "2026-11-16", priority: 1 });
    const high = await newTask(call, "Prioridade", { dueDate: "2026-11-16", dueTime: "09:00", priority: 1 });
    const past = await newTask(call, "Anterior", { dueDate: "2026-11-14" });
    const done = await completeTaskById(call, await newTask(call, "Feita antes da meia-noite"));
    const archive = await newProject(call, "Arquivo");
    await newTask(call, "Arquivada", { projectId: archive.id, dueDate: "2026-11-16" });
    await completeTaskById(call, await newTask(call, "Concluída e arquivada", { projectId: archive.id }));
    expect((await call("POST", `/projects/${archive.id}/archive`, { revision: archive.revision })).status).toBe(200);

    const before = await payload<Today>(await call("GET", "/views/today"));
    expect(before).toMatchObject({ referenceDate: "2026-11-16", timezone: "America/Maceio" });
    expect(before.completedToday).toBeUndefined();
    expect(before.overdue.map(({ id }) => id)).toEqual([past.id]);
    expect(before.today.map(({ id }) => id)).toEqual([first.id, high.id, child.id, unTimed.id]);
    expect(before.today[2].origin).toMatchObject({ projectName: "Ativo", sectionName: "Seção de teste", parentTitle: "Pai" });
    const included = await payload<Today>(await call("GET", "/views/today?includeCompleted=true"));
    expect(included.completedToday?.map(({ id }) => id)).toEqual([done.task.id]);
    expect((await nav(call)).todayCount).toBe(before.today.length + before.overdue.length);

    clock.mockReturnValue(Temporal.Instant.from("2026-11-17T03:00:00Z"));
    const afterDone = await completeTaskById(call, await newTask(call, "Feita depois da meia-noite"));
    const after = await payload<Today>(await call("GET", "/views/today?includeCompleted=true"));
    expect(after.referenceDate).toBe("2026-11-17");
    expect(after.today).toEqual([]);
    expect(after.overdue.map(({ id }) => id)).toEqual([past.id, first.id, high.id, child.id, unTimed.id]);
    expect(after.completedToday?.map(({ id }) => id)).toEqual([afterDone.task.id]);

    expect((await call("PATCH", "/preferences", { timezone: "Pacific/Honolulu" })).status).toBe(200);
    const changedZone = await payload<Today>(await call("GET", "/views/today"));
    expect(changedZone.referenceDate).toBe("2026-11-16");
    expect(changedZone.today.map(({ id }) => id)).toEqual([first.id, high.id, child.id, unTimed.id]);
  });

  it("returns seven days from tomorrow or a chosen future date, with empty days retained", async () => {
    now("2026-11-16T14:00:00Z");
    const call = await accountFixture();
    const first = await newTask(call, "Amanhã", { dueDate: "2026-11-17", dueTime: "08:00" });
    const withoutTime = await newTask(call, "Depois", { dueDate: "2026-11-17", priority: 1 });
    const parent = await newTask(call, "Sem data");
    const final = await newTask(call, "Último dia", { parentId: parent.id, dueDate: "2026-11-23" });
    const outside = await newTask(call, "Semana seguinte", { dueDate: "2026-11-24" });
    await newTask(call, "Hoje", { dueDate: "2026-11-16" });
    await completeTaskById(call, await newTask(call, "Concluída", { dueDate: "2026-11-17" }));

    const response = await payload<Upcoming>(await call("GET", "/views/upcoming"));
    expect(response).toMatchObject({ referenceDate: "2026-11-16", start: "2026-11-17" });
    expect(response.days.map(({ date }) => date)).toEqual([
      "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23",
    ]);
    expect(response.days[0].tasks.map(({ id }) => id)).toEqual([first.id, withoutTime.id]);
    expect(response.days.slice(1, 6).every(({ tasks }) => !tasks.length)).toBe(true);
    expect(response.days[6].tasks).toMatchObject([{ id: final.id, origin: { parentTitle: "Sem data" } }]);
    const next = await payload<Upcoming>(await call("GET", "/views/upcoming?start=2026-11-24"));
    expect(next.days[0].tasks).toMatchObject([{ id: outside.id }]);
    await failure(await call("GET", "/views/upcoming?start=2026-11-16"), 422, "VALIDATION_FAILED");
    await failure(await call("GET", "/views/upcoming?start=9999-12-31"), 422, "VALIDATION_FAILED");
  });
});

describe("temporary search and filters", () => {
  it("combines literal accent-insensitive text and filters, paginates active first and isolates cursors", async () => {
    now("2026-11-17T16:00:00Z");
    const [call, other] = await Promise.all([accountFixture(), accountFixture()]);
    const project = await newProject(call, "Pesquisa");
    const label = await newLabel(call, "Marcador");
    const section = await newSection(call, project.id, "Seção");
    const parent = await newTask(call, "Contexto do pai", { projectId: project.id, sectionId: section.id });
    const fields = { projectId: project.id, labelIds: [label.id], priority: 2, dueDate: "2026-11-17" };
    const child = await newTask(call, "Preparar", { ...fields, parentId: parent.id, description: "Café 100%_fresco" });
    const finished = await completeTaskById(call, await newTask(call, "CAFE\u0301 100%_fresco", fields));
    await newTask(call, "Cafe 100ABfresco", fields);
    await newTask(call, "Café 100%_fresco", { ...fields, priority: 1 });
    await newTask(call, "Café 100%_fresco", { ...fields, labelIds: [] });
    await newTask(call, "Café 100%_fresco", { ...fields, dueDate: "2026-11-18" });
    await newTask(call, "Café 100%_fresco", { ...fields, projectId: undefined });

    const input = {
      text: "cafe 100%_fresco", projectId: project.id, labelId: label.id, priority: 2,
      date: { kind: "range", from: "2026-11-17", to: "2026-11-17" }, includeCompleted: true, limit: 1,
    };
    const first = await payload<Search>(await call("POST", "/search", input));
    expect(first.results).toMatchObject([{
      id: child.id, status: "active", origin: { projectName: "Pesquisa", sectionName: "Seção", parentTitle: "Contexto do pai" },
      labels: [{ id: label.id, name: "Marcador" }],
    }]);
    expect(first.nextCursor).toBeTruthy();
    const second = await payload<Search>(await call("POST", "/search", { ...input, text: "CAFÉ 100%_FRESCO", cursor: first.nextCursor }));
    expect(second.results).toMatchObject([{ id: finished.task.id, status: "completed" }]);
    expect(second.nextCursor).toBeNull();
    await failure(await call("POST", "/search", { ...input, priority: 1, cursor: first.nextCursor }), 422, "VALIDATION_FAILED");
    await failure(await other("POST", "/search", { text: "cafe", cursor: first.nextCursor }), 422, "VALIDATION_FAILED");
    await failure(await other("POST", "/search", { projectId: project.id }), 404, "NOT_FOUND");
    await failure(await other("POST", "/search", { labelId: label.id }), 404, "NOT_FOUND");
    const { results } = await payload<Search>(await call("POST", "/search", { ...input, includeCompleted: false, limit: 50 }));
    expect(results.map(({ id }) => id)).toEqual([child.id]);
  });

  it("handles date filters, ignores archived projects and only uses real search criteria", async () => {
    const clock = now("2026-11-17T02:59:59Z");
    const call = await accountFixture();
    const overdue = await newTask(call, "Atrasada", { dueDate: "2026-11-15" });
    const second = await newTask(call, "Também atrasada", { dueDate: "2026-11-14" });
    const onTime = await newTask(call, "Hoje", { dueDate: "2026-11-16" });
    const noDate = await newTask(call, "Sem data");
    await completeTaskById(call, await newTask(call, "Atrasada concluída", { dueDate: "2026-11-12" }));
    const archived = await newProject(call, "Arquivo");
    await newTask(call, "Atrasada", { projectId: archived.id, dueDate: "2026-11-15" });
    expect((await call("POST", `/projects/${archived.id}/archive`, { revision: archived.revision })).status).toBe(200);

    const find = (input: unknown) => call("POST", "/search", input).then((response) => payload<Search>(response));
    expect(await find({ includeCompleted: true, text: "" })).toMatchObject({ results: [], nextCursor: null });
    expect((await find({ date: { kind: "none" } })).results.map(({ id }) => id)).toEqual([noDate.id]);
    expect((await find({ date: { kind: "today" } })).results.map(({ id }) => id)).toEqual([onTime.id]);
    expect((await find({ date: { kind: "overdue" }, includeCompleted: true })).results.map(({ id }) => id).sort())
      .toEqual([overdue.id, second.id].sort());
    expect(await find({ projectId: archived.id })).toMatchObject({ results: [], nextCursor: null });
    await failure(await call("POST", "/search", { date: { kind: "range", from: "2026-11-17", to: "2026-11-16" } }),
      422, "VALIDATION_FAILED");
    const first = await find({ date: { kind: "overdue" }, limit: 1 });
    clock.mockReturnValue(Temporal.Instant.from("2026-11-17T03:00:00Z"));
    await failure(await call("POST", "/search", { date: { kind: "overdue" }, cursor: first.nextCursor }), 422, "VALIDATION_FAILED");
  });
});

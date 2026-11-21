import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { Client as PgClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPreferences } from "@feito/core/domain/preferences";
import type { TodayView, UpcomingView } from "@feito/core/types";
import { productCache } from "@/server/db/product-cache";
import { withDekWrite } from "@/server/db/product-crypto";
import { preferences } from "@/server/db/schema";
import { advanceProductRevision } from "@/server/db/tenant";
import { writePreferences } from "@/server/db/workspace";
import {
  accountFixture, completeTaskById, failure, nav, newLabel, newProject, newSection, newTask,
  page, payload, productAccess, send, type Client,
} from "./product-client";

const today = (call: Client, query = "") =>
  call("GET", "/views/today" + query).then((response) => payload<TodayView>(response));
const upcoming = (call: Client, query = "") =>
  call("GET", "/views/upcoming" + query).then((response) => payload<UpcomingView>(response));

function setClock(value: string) {
  return vi.spyOn(Temporal.Now, "instant").mockReturnValue(Temporal.Instant.from(value));
}

function observeQueries() {
  const sql: string[] = [];
  const query = PgClient.prototype.query;
  vi.spyOn(PgClient.prototype, "query").mockImplementation(function (this: PgClient, ...args: unknown[]) {
    const config = args[0] as { text?: string } | string;
    sql.push(typeof config === "string" ? config : config.text ?? "");
    return Reflect.apply(query, this, args);
  });
  return {
    clear: () => { sql.length = 0; },
    tasks: () => sql.filter((statement) => statement.includes('from "domain"."tasks"')),
    revisions: () => sql.filter((statement) => statement.includes('"product_revision"')),
    domain: () => sql.filter((statement) => statement.includes('"domain"')),
    sessions: () => sql.filter((statement) => statement.includes('from "identity"."session"')),
  };
}

describe("single-process product cache", () => {
  beforeEach(() => vi.stubEnv("FEITO_PRODUCT_CACHE_MODE", "single-process"));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("isolates accounts and view parameters and only queries auth on hits", async () => {
    setClock("2026-05-12T14:00:00Z");
    const first = await accountFixture();
    const second = await accountFixture();
    const project = await newProject(first);
    const otherProject = await newProject(first);
    const active = await newTask(first, "Ativa", { projectId: project.id, dueDate: "2026-05-12" });
    const done = await newTask(first, "Concluída", { projectId: project.id, dueDate: "2026-05-12" });
    const tomorrow = await newTask(first, "Amanhã", { projectId: otherProject.id, dueDate: "2026-05-13" });
    const otherTask = await newTask(second, "Outra conta", { dueDate: "2026-05-12" });
    await completeTaskById(first, done);
    await payload(await first("PATCH", `/projects/${project.id}/view`, { showCompleted: true }));

    const queries = observeQueries();
    expect((await today(first)).today).toMatchObject([{ id: active.id }]);
    expect(queries.tasks()).toHaveLength(1);
    queries.clear();
    expect((await today(first, "?includeCompleted=false")).today).toMatchObject([{ id: active.id }]);
    expect(queries.domain()).toEqual([]);
    expect((await today(first, "?includeCompleted=true")).completedToday).toMatchObject([{ id: done.id }]);
    expect((await today(second)).today).toMatchObject([{ id: otherTask.id }]);

    expect((await upcoming(first)).days[0]).toMatchObject({ date: "2026-05-13", tasks: [{ id: tomorrow.id }] });
    expect((await upcoming(first, "?start=2026-05-14")).days[0]).toEqual({ date: "2026-05-14", tasks: [] });
    expect((await page(first, project.id)).tasks.map(({ id }) => id)).toEqual([active.id, done.id]);
    expect((await page(first, project.id, "?includeCompleted=false")).tasks).toMatchObject([{ id: active.id }]);
    expect(await page(first, project.id, "?includeCompleted=true")).toEqual(await page(first, project.id));
    expect((await page(first, otherProject.id)).tasks).toMatchObject([{ id: tomorrow.id }]);
    await failure(await second("GET", `/projects/${project.id}`), 404, "NOT_FOUND");
    await failure(await send("GET", "/views/today"), 401, "UNAUTHENTICATED");

    await nav(first);
    queries.clear();
    await today(first, "?includeCompleted=true");
    await upcoming(first, "?start=2026-05-14");
    await page(first, project.id);
    await page(first, project.id, "?includeCompleted=false");
    await nav(first);
    expect(queries.sessions().length).toBeGreaterThanOrEqual(5);
    expect(queries.revisions()).toEqual([]);
    expect(queries.tasks()).toEqual([]);
    expect(queries.domain()).toEqual([]);

    await newSection(first, project.id, "Seção nova");
    const label = await newLabel(first, "Etiqueta nova");
    await payload(await first("PATCH", `/tasks/${active.id}`, { revision: active.revision, labelIds: [label.id] }));
    await payload(await first("PATCH", `/tasks/${tomorrow.id}`, { revision: tomorrow.revision, dueDate: "2026-05-14" }));
    queries.clear();
    expect((await page(first, project.id)).sections).toMatchObject([{ name: "Seção nova" }]);
    expect((await today(first)).today).toMatchObject([{ id: active.id, labels: [{ id: label.id }] }]);
    expect((await upcoming(first, "?start=2026-05-14")).days[0].tasks).toMatchObject([{ id: tomorrow.id }]);
    expect((await nav(first)).labels).toMatchObject([{ id: label.id, activeCount: 1 }]);
    expect(queries.tasks()).toHaveLength(4);
    queries.clear();
    expect((await today(second)).today).toMatchObject([{ id: otherTask.id }]);
    expect(queries.domain()).toEqual([]);
  });

  it("returns description excerpts and bypasses retention only for projections that contain them", async () => {
    setClock("2026-05-12T14:00:00Z");
    const call = await accountFixture();
    const project = await newProject(call);
    const task = await newTask(call, "Com descrição", {
      projectId: project.id, dueDate: "2026-05-12", description: "\nPrimeira linha\nSegunda linha",
    });
    await newTask(call, "Amanhã com descrição", {
      projectId: project.id, dueDate: "2026-05-13", description: "Outro trecho",
    });
    const queries = observeQueries();
    for (let read = 0; read < 2; read++) {
      expect((await today(call)).today).toMatchObject([{ id: task.id, descriptionExcerpt: "Primeira linha" }]);
      expect((await upcoming(call)).days[0].tasks).toMatchObject([{ descriptionExcerpt: "Outro trecho" }]);
      expect((await page(call, project.id)).tasks).toMatchObject([
        { descriptionExcerpt: "Primeira linha" }, { descriptionExcerpt: "Outro trecho" },
      ]);
    }
    expect(queries.tasks()).toHaveLength(6);
    expect((await upcoming(call, "?start=2026-05-14")).days[0].tasks).toEqual([]);
    queries.clear();
    await upcoming(call, "?start=2026-05-14");
    expect(queries.domain()).toEqual([]);
  });

  it("updates Today, Upcoming, project overdue flags and navigation at midnight and on timezone changes", async () => {
    const clock = setClock("2026-05-12T02:59:00Z");
    const call = await accountFixture();
    const task = await newTask(call, "Vencimento", { dueDate: "2026-05-11" });
    const later = await newTask(call, "Mais tarde", { dueDate: "2026-05-12" });
    expect((await today(call)).today).toMatchObject([{ id: task.id }]);
    expect((await upcoming(call, "?start=2026-05-12")).days[0].tasks).toMatchObject([{ id: later.id }]);
    expect((await page(call, task.projectId)).tasks[0]).toMatchObject({ id: task.id, overdue: false });
    expect(await nav(call)).toMatchObject({ referenceDate: "2026-05-11", todayCount: 1 });

    clock.mockReturnValue(Temporal.Instant.from("2026-05-12T03:01:00Z"));
    expect((await today(call)).overdue).toMatchObject([{ id: task.id }]);
    expect(await upcoming(call)).toMatchObject({ referenceDate: "2026-05-12", start: "2026-05-13" });
    await failure(await call("GET", "/views/upcoming?start=2026-05-12"), 422, "VALIDATION_FAILED");
    expect((await page(call, task.projectId)).tasks[0]).toMatchObject({ id: task.id, overdue: true });
    expect(await nav(call)).toMatchObject({ referenceDate: "2026-05-12", todayCount: 2 });

    await payload(await call("PATCH", "/preferences", { timezone: "Pacific/Honolulu" }));
    expect(await today(call)).toMatchObject({ referenceDate: "2026-05-11", timezone: "Pacific/Honolulu" });
    expect(await upcoming(call)).toMatchObject({ referenceDate: "2026-05-11", start: "2026-05-12" });
    expect((await page(call, task.projectId)).tasks[0]).toMatchObject({ id: task.id, overdue: false });
    expect(await nav(call)).toMatchObject({ referenceDate: "2026-05-11", todayCount: 1 });
  });

  it("retries a projection when midnight passes during its load", async () => {
    const clock = setClock("2026-05-12T02:59:00Z");
    const call = await accountFixture();
    const { db } = productAccess(call);
    const transaction = db.transaction.bind(db);
    const loaded = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let paused = false;
    vi.spyOn(db, "transaction").mockImplementation(async (run, config) => {
      const value = await transaction(run, config);
      if (config?.accessMode === "read only" && !paused) {
        paused = true;
        loaded.resolve();
        await release.promise;
      }
      return value;
    });

    const pending = upcoming(call);
    try {
      await Promise.race([loaded.promise, pending]);
      clock.mockReturnValue(Temporal.Instant.from("2026-05-12T03:01:00Z"));
    } finally {
      release.resolve();
    }
    expect(await pending).toMatchObject({ referenceDate: "2026-05-12", start: "2026-05-13" });
    const queries = observeQueries();
    expect(await upcoming(call)).toEqual(await pending);
    expect(queries.domain()).toEqual([]);
  });

  it("preserves warm entries on rollback and fences old loads across overlapping commits", async () => {
    setClock("2026-05-12T02:59:00Z");
    const call = await accountFixture();
    const { db, keys, tenantId } = productAccess(call);
    const stageTimezone = <T>(timezone: string, next: () => Promise<T>) =>
      withDekWrite(db, keys, tenantId, 1, async (tx, version, dek, tenant) => {
        const [row] = await tx.select({ revision: preferences.revision }).from(preferences);
        await writePreferences(tx, tenantId, version, dek.key, row.revision + 1, { ...defaultPreferences, timezone });
        await advanceProductRevision(tx, tenant);
        return next();
      });

    const before = await nav(call);
    const queries = observeQueries();
    await expect(stageTimezone("UTC", async () => { throw new Error("rollback fixture"); })).rejects.toThrow("rollback fixture");
    queries.clear();
    expect(await nav(call)).toEqual(before);
    expect(queries.domain()).toEqual([]);

    const hold = () => ({ entered: Promise.withResolvers<void>(), exit: Promise.withResolvers<void>() });
    const oldRead = hold();
    const newRead = hold();
    const first = hold();
    const second = hold();
    const transaction = db.transaction.bind(db);
    let readSnapshots = 0;
    vi.spyOn(db, "transaction").mockImplementation(async (run, config) => {
      const value = await transaction(run, config);
      const marker = value && typeof value === "object" && "value" in value ? value.value : undefined;
      const gate = marker === first ? first : marker === second ? second
        : config?.accessMode === "read only" ? [oldRead, newRead][readSnapshots++] : undefined;
      if (gate) {
        gate.entered.resolve();
        await gate.exit.promise;
      }
      return value;
    });

    const old = today(call);
    let writeOne: Promise<unknown> | undefined;
    let writeTwo: Promise<unknown> | undefined;
    let subsequent: Promise<TodayView> | undefined;
    let concurrent: Promise<TodayView> | undefined;
    try {
      await Promise.race([oldRead.entered.promise, old]);
      writeOne = stageTimezone("Pacific/Auckland", async () => first);
      await Promise.race([first.entered.promise, writeOne]);
      writeTwo = stageTimezone("UTC", async () => second);
      await Promise.race([second.entered.promise, writeTwo]);

      const accessed = vi.spyOn(productCache, "readLocal");
      subsequent = today(call);
      await vi.waitFor(() => expect(accessed).toHaveBeenCalledTimes(1));
      first.exit.resolve();
      await writeOne;
      expect(queries.tasks()).toHaveLength(1);
      second.exit.resolve();
      await writeTwo;
      await vi.waitFor(() => expect(readSnapshots).toBe(2));
      oldRead.exit.resolve();
      expect(await old).toMatchObject({ timezone: defaultPreferences.timezone });
      concurrent = today(call);
      await vi.waitFor(() => expect(accessed).toHaveBeenCalledTimes(2));
      newRead.exit.resolve();
      expect(await subsequent).toMatchObject({ timezone: "UTC" });
      expect(await concurrent).toEqual(await subsequent);
      expect(queries.tasks()).toHaveLength(2);
      queries.clear();
      expect(await today(call)).toEqual(await subsequent);
      expect(queries.domain()).toEqual([]);
      expect(await nav(call)).toMatchObject({ referenceDate: "2026-05-12" });
    } finally {
      for (const gate of [oldRead, newRead, first, second]) gate.exit.resolve();
      await Promise.allSettled([old, writeOne, writeTwo, subsequent, concurrent]);
    }
  });

  it("refreshes after a real import and desktop sync and keeps hits on idempotent replays", async () => {
    setClock("2026-05-12T14:00:00Z");
    const source = await accountFixture();
    const target = await accountFixture();
    await newTask(source, "Importada", { dueDate: "2026-05-12" });
    const downloaded = await source("GET", "/export");
    expect(downloaded.status).toBe(200);
    const file = await downloaded.text();
    const preview = await target("POST", "/import/preview", undefined, { raw: file });
    const { previewToken } = await payload<{ previewToken: string }>(preview);
    const confirm = () => target("POST", "/import/confirm", undefined, { raw: file, headers: {
      "X-Operation-Id": preview.headers.get("X-Operation-Id")!, "X-Preview-Token": previewToken,
    } });

    expect((await today(target)).today).toEqual([]);
    const inbox = (await nav(target)).inbox.projectId;
    expect((await page(target, inbox)).tasks).toEqual([]);
    const receipt = await payload(await confirm());
    expect((await today(target)).today).toMatchObject([{ title: "Importada" }]);
    expect((await page(target, inbox)).tasks).toMatchObject([{ title: "Importada" }]);
    expect((await nav(target)).todayCount).toBe(1);

    const queries = observeQueries();
    expect(await payload(await confirm())).toEqual(receipt);
    queries.clear();
    await today(target);
    await page(target, inbox);
    await nav(target);
    expect(queries.domain()).toEqual([]);

    const desktopTask = randomUUID();
    const command = {
      id: randomUUID(), authoredAt: "2026-05-12T14:00:00Z", method: "POST", path: "/tasks",
      generatedIds: [desktopTask], body: { title: "Sincronizada", dueDate: "2026-05-12" },
    };
    expect(await payload(await target("POST", "/desktop-sync", command))).toEqual({ outcome: "applied" });
    expect((await today(target)).today).toEqual(expect.arrayContaining([expect.objectContaining({ id: desktopTask })]));
    expect((await nav(target)).todayCount).toBe(2);
    expect(await payload(await target("POST", "/desktop-sync", command))).toEqual({ outcome: "applied" });
    queries.clear();
    await today(target);
    await nav(target);
    expect(queries.domain()).toEqual([]);
  });
});

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPreferences } from "@/domain/preferences";
import { connectDatabase } from "@/server/db/client";
import { withDekWrite } from "@/server/db/product-crypto";
import { activateDek, rekeyWithActiveDek } from "@/server/db/rotation";
import { preferences } from "@/server/db/schema";
import { advanceProductRevision } from "@/server/db/tenant";
import { writePreferences } from "@/server/db/workspace";
import { logger } from "@/server/logger";
import { accountFixture, failure, nav, newLabel, newProject, newTask, payload, productAccess, send } from "./product-client";

const runNode = promisify(execFile);

type ReadMetric = { operation: "product_projection_read"; projection: string; cache: string; domainQueriesAvoided: number; durationMs: number };

function cacheMetrics(calls: [unknown, ...unknown[]][]) {
  return calls.map(([entry]) => entry).filter((entry): entry is ReadMetric =>
    !!entry && typeof entry === "object" && "operation" in entry && entry.operation === "product_projection_read");
}

describe("revision-checked product read cache", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shares concurrent reads, avoids the cold scan on hits and isolates authorized sessions", async () => {
    const first = await accountFixture();
    const second = await accountFixture();
    const original = await newTask(first, "Primeira conta");
    const distinct = await newTask(second, "Segunda conta");
    const logs = vi.spyOn(logger, "info");
    const metrics = () => cacheMetrics(logs.mock.calls);
    const both = await Promise.all([nav(first), nav(first), nav(first)]);
    for (const result of both) expect(result.inbox).toEqual({ projectId: original.projectId, activeCount: 1 });
    expect(await nav(first)).toEqual(both[0]);
    expect(metrics().filter((entry) => entry.cache === "miss")).toHaveLength(1);
    expect(metrics().at(-1)).toMatchObject({ cache: "hit", domainQueriesAvoided: 4, durationMs: expect.any(Number) });
    expect((await nav(second)).inbox).toEqual({ projectId: distinct.projectId, activeCount: 1 });
    expect(metrics().at(-1)).toMatchObject({ cache: "miss", domainQueriesAvoided: 0, durationMs: expect.any(Number) });
    expect(Object.keys(metrics()[0]).sort()).toEqual(["cache", "domainQueriesAvoided", "durationMs", "operation", "projection"]);
    const count = metrics().length;
    await failure(await send("GET", "/navigation"), 401, "UNAUTHENTICATED");
    expect(metrics()).toHaveLength(count);
  });

  it("starts each requested projection cold and avoids task scans for archived projects", async () => {
    const call = await accountFixture();
    const project = await newProject(call);
    const label = await newLabel(call);
    await newTask(call, "Ativa", { projectId: project.id, labelIds: [label.id] });
    const logs = vi.spyOn(logger, "info");

    await nav(call);
    await payload(await call("GET", "/labels"));
    await payload(await call("GET", "/projects?status=archived"));
    expect(cacheMetrics(logs.mock.calls).map(({ projection, cache }) => [projection, cache])).toEqual([
      ["navigation", "miss"], ["labels", "miss"], ["projects:archived", "miss"],
    ]);

    expect(await payload(await call("GET", "/labels"))).toMatchObject({
      labels: [{ id: label.id, activeCount: 1 }],
    });
    expect(cacheMetrics(logs.mock.calls).at(-1)).toMatchObject({
      projection: "labels", cache: "hit", domainQueriesAvoided: 4,
    });
    await payload(await call("GET", "/projects?status=archived"));
    expect(cacheMetrics(logs.mock.calls).at(-1)).toMatchObject({
      projection: "projects:archived", cache: "hit", domainQueriesAvoided: 1,
    });
  });

  it("keeps a cached projection during a rolled-back transaction and rejects it after an independent writer commits", async () => {
    const call = await accountFixture();
    const original = await newTask(call, "Antes");
    const reader = productAccess(call);
    const separate = connectDatabase("DOMAIN_DATABASE_URL", 2);
    const writer = { ...reader, db: separate.db };
    const logs = vi.spyOn(logger, "info");
    const lastRead = () => cacheMetrics(logs.mock.calls).at(-1);
    const read = () => nav(call);
    const before = await read();
    expect(before.inbox).toEqual({ projectId: original.projectId, activeCount: 1 });
    try {
      expect(await read()).toEqual(before);
      const staged = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const transaction = withDekWrite(writer.db, writer.keys, writer.tenantId, 1, async (tx, version, dek, tenant) => {
        const [row] = await tx.select({ revision: preferences.revision }).from(preferences);
        await writePreferences(tx, tenant.id, version, dek.key, row.revision + 1,
          { ...defaultPreferences, timezone: "UTC" });
        await advanceProductRevision(tx, tenant);
        staged.resolve();
        await release.promise;
        throw new Error("rollback fixture");
      });
      const failure = expect(transaction).rejects.toThrow("rollback fixture");
      try {
        await Promise.race([staged.promise, transaction]);
        expect(await read()).toEqual(before);
        expect(lastRead()).toMatchObject({ cache: "hit" });
      } finally {
        release.resolve();
        await failure;
      }
      expect(await read()).toEqual(before);
      expect(lastRead()).toMatchObject({ cache: "hit" });
      await runNode(process.execPath, ["--conditions=react-server", "--import", "tsx", "-e", `
        const { getRuntime } = require("./src/server/runtime.ts");
        const { createTask } = require("./src/server/services/tasks.ts");
        const runtime = getRuntime();
        createTask({ db: runtime.db, keys: runtime.keys, tenantId: process.argv[1] }, { title: "Depois" })
          .then(({ id }) => process.stdout.write(id)).finally(runtime.close);
      `, writer.tenantId]);
      expect(await read()).toEqual({ ...before, inbox: { ...before.inbox, activeCount: 2 } });
      expect(lastRead()).toMatchObject({ cache: "miss" });
      expect((await read()).inbox.activeCount).toBe(2);
      expect(lastRead()).toMatchObject({ cache: "hit" });
    } finally {
      await separate.close();
    }
  });

  it("refreshes navigation counts across midnight and reloads after preference and key changes", async () => {
    const call = await accountFixture();
    await newTask(call, "Revisão", { dueDate: "2026-05-12" });
    const reader = productAccess(call);
    const separate = connectDatabase("DOMAIN_DATABASE_URL", 2);
    const writer = { ...reader, db: separate.db };
    const logs = vi.spyOn(logger, "info");
    const snapshot = () => nav(call);
    try {
      const now = vi.spyOn(Temporal.Now, "instant").mockReturnValue(Temporal.Instant.from("2026-05-12T02:59:00Z"));
      expect(await snapshot()).toMatchObject({ referenceDate: "2026-05-11", todayCount: 0 });
      now.mockReturnValue(Temporal.Instant.from("2026-05-12T03:01:00Z"));
      expect(await snapshot()).toMatchObject({ referenceDate: "2026-05-12", todayCount: 1 });
      expect(await snapshot()).toMatchObject({ referenceDate: "2026-05-12", todayCount: 1 });
      await call("PATCH", "/preferences", { timezone: "Pacific/Honolulu" });
      expect(await snapshot()).toMatchObject({ referenceDate: "2026-05-11", todayCount: 0 });
      expect(await activateDek(writer)).toBe(2);
      expect(await snapshot()).toMatchObject({ referenceDate: "2026-05-11", todayCount: 0 });
      expect(await rekeyWithActiveDek(writer)).toBeGreaterThan(0);
      expect(await snapshot()).toMatchObject({ referenceDate: "2026-05-11", todayCount: 0 });
      const states = cacheMetrics(logs.mock.calls).map((entry) => entry.cache);
      expect(states).toEqual(["miss", "miss", "hit", "miss", "miss", "miss"]);
    } finally {
      await separate.close();
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { productCache } from "@/server/db/product-cache";
import type { ProductAccess } from "@/server/db/product";

function access() {
  return { db: {}, keys: {}, tenantId: "account" } as ProductAccess;
}

function projection(name = "home") {
  return { labels: [{ id: "label", revision: 1, name, activeCount: 1 }] };
}

describe("on-demand product projection cache", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces the same tenant and revision and isolates projections, tenants, databases and key configurations", async () => {
    const first = access();
    const input = projection();
    const load = vi.fn(async () => input);
    const [miss, shared] = await Promise.all([productCache.read(first, "labels", 0, load), productCache.read(first, "labels", 0, load)]);
    expect(miss).toEqual({ value: input, cache: "miss" });
    expect(shared).toEqual({ value: input, cache: "coalesced" });
    expect(await productCache.read(first, "labels", 0, load)).toEqual({ value: input, cache: "hit" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(input.labels[0])).toBe(true);

    for (const separate of [{ ...first, tenantId: "other" }, { ...access(), keys: first.keys }, { ...first, keys: access().keys }]) {
      const ownRecords = projection("different");
      expect(await productCache.read(separate, "labels", 0, async () => ownRecords)).toEqual({ value: ownRecords, cache: "miss" });
    }
    const archive = { projects: [] };
    expect(await productCache.read(first, "projects:archived", 0, async () => archive)).toEqual({ value: archive, cache: "miss" });
    expect((await productCache.read(first, "labels", 0, load)).value).toBe(input);
  });

  it("keeps the newest revision after overlapping loads and retries failures", async () => {
    const account = access();
    const oldRecords = projection("old");
    const newRecords = projection("new");
    const old = Promise.withResolvers<ReturnType<typeof projection>>();
    const pending = productCache.read(account, "labels", 1, () => old.promise);
    const other = productCache.read(account, "labels", 1, () => Promise.reject(new Error("unexpected loader")));
    expect(await productCache.read(account, "labels", 2, async () => newRecords)).toEqual({ value: newRecords, cache: "miss" });
    old.resolve(oldRecords);
    expect((await pending).value).toBe(oldRecords);
    expect(await other).toEqual({ value: oldRecords, cache: "coalesced" });
    expect(await productCache.read(account, "labels", 2, async () => oldRecords)).toEqual({ value: newRecords, cache: "hit" });
    await expect(productCache.read(account, "labels", 3, async () => { throw new Error("database read failed"); }))
      .rejects.toThrow("database read failed");
    expect((await productCache.read(account, "labels", 3, async () => projection())).cache).toBe("miss");
  });

  it("does not reuse a coalesced navigation result across midnight", async () => {
    const account = access();
    const before = Promise.withResolvers<{ date: string }>();
    const oldRead = productCache.read(account, "navigation", 0, () => before.promise);
    const newRead = productCache.read(account, "navigation", 0, async () => ({ date: "2026-11-20" }),
      (value) => value.date === "2026-11-20");
    before.resolve({ date: "2026-11-19" });
    await expect(oldRead).resolves.toMatchObject({ value: { date: "2026-11-19" } });
    await expect(newRead).resolves.toEqual({ value: { date: "2026-11-20" }, cache: "miss" });
  });

  it("retains a projection for twelve hours and does not retain oversized projections", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const sixHours = 6 * 60 * 60_000;
    const account = access();
    const load = vi.fn(async () => projection());
    await productCache.read(account, "labels", 0, load);
    await vi.advanceTimersByTimeAsync(sixHours);
    expect((await productCache.read(account, "labels", 0, load)).cache).toBe("hit");
    await vi.advanceTimersByTimeAsync(sixHours - 1);
    expect((await productCache.read(account, "labels", 0, load)).cache).toBe("hit");
    await vi.advanceTimersByTimeAsync(1);
    expect((await productCache.read(account, "labels", 0, load)).cache).toBe("miss");
    expect(load).toHaveBeenCalledTimes(2);

    const largeAccount = access();
    const oversized = vi.fn(async () => projection("x".repeat(2 * 1024 * 1024)));
    await productCache.read(largeAccount, "labels", 0, oversized);
    expect((await productCache.read(largeAccount, "labels", 0, oversized)).cache).toBe("miss");
    expect(oversized).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * sixHours);
  });

  it("evicts the least recently used entry when the entry budget is full", async () => {
    const pinned = access();
    const oldest = access();
    const load = async () => projection();
    await productCache.read(pinned, "labels", 0, load);
    await productCache.read(oldest, "labels", 0, load);
    for (let index = 0; index < 62; index++) await productCache.read(access(), "labels", 0, load);
    expect((await productCache.read(pinned, "labels", 0, load)).cache).toBe("hit");
    await productCache.read(access(), "labels", 0, load);
    expect((await productCache.read(pinned, "labels", 0, load)).cache).toBe("hit");
    expect((await productCache.read(oldest, "labels", 0, load)).cache).toBe("miss");
  });

  it("shares expiration and entry and process byte limits with local lists", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const ttl = 12 * 60 * 60_000;
    const account = access();
    const load = async () => ({ data: projection() });
    const read = (id: string) => productCache.readLocal(account, "project", [id], load);
    expect((await read("first")).cache).toBe("miss");
    await vi.advanceTimersByTimeAsync(ttl - 1);
    expect((await read("first")).cache).toBe("hit");
    await vi.advanceTimersByTimeAsync(1);
    expect((await read("first")).cache).toBe("miss");

    const nearLimit = "x".repeat(1_900_000);
    const large = async () => ({ data: projection(nearLimit) });
    for (const id of ["a", "b", "c", "d"]) {
      await productCache.readLocal(account, "project", [id], large);
    }
    expect((await read("first")).cache).toBe("hit");
    await productCache.read(access(), "labels", 0, async () => projection(nearLimit));
    expect((await productCache.readLocal(account, "project", ["a"], load)).cache).toBe("miss");
    expect((await productCache.readLocal(account, "project", ["d"], load)).cache).toBe("hit");

    const oversized = async () => ({ data: projection("x".repeat(2 * 1024 * 1024)) });
    await productCache.readLocal(account, "project", ["oversized"], oversized);
    expect((await productCache.readLocal(account, "project", ["oversized"], load)).cache).toBe("miss");
    await vi.advanceTimersByTimeAsync(ttl);
  });
});

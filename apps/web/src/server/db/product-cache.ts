import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { referenceDate } from "@feito/core/domain/preferences";
import type { ProductCalendar, ProductProjection } from "@feito/core/product/port";
import { logger } from "@/server/logger";
import type { ProductAccess } from "./product";

const ttlMs = 12 * 60 * 60_000;
const maxEntries = 64;
const maxBytes = 16 * 1024 * 1024;
const maxEntryBytes = 4 * 1024 * 1024;

type Entry = { revision: number; value: unknown; weight: number; expiresAt: number; timer: NodeJS.Timeout };
type CacheResult<T> = { value: T; cache: "hit" | "miss" | "coalesced" | "bypass" };
type ReadContext<T> = { data: T; calendar?: ProductCalendar };
type TaskListProjection = "today" | "upcoming" | "project";
type ProjectionParameters = readonly (string | boolean | undefined)[];

export function usesLocalProductCache() {
  return process.env.FEITO_PRODUCT_CACHE_MODE === "single-process";
}

function hasDescriptionExcerpt(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) =>
    key === "descriptionExcerpt" ? item != null : hasDescriptionExcerpt(item));
}

function estimateAndFreeze(value: unknown): number {
  if (typeof value === "string") return 24 + value.length * 2;
  if (value === null || typeof value !== "object") return 8;
  let weight = 64;
  for (const item of Object.values(value)) weight += 16 + estimateAndFreeze(item);
  Object.freeze(value);
  return weight;
}

class ProductCache {
  private identities = new WeakMap<object, number>();
  private nextIdentity = 0;
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<unknown>>();
  private inFlight = 0;
  private commits = new Map<string, { count: number; done: Promise<void>; resolve: () => void }>();
  private bytes = 0;

  private identity(value: object) {
    const id = this.identities.get(value);
    if (id !== undefined) return id;
    const next = this.nextIdentity++;
    this.identities.set(value, next);
    return next;
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.bytes -= entry.weight;
    this.entries.delete(key);
  }

  private expire(key: string) {
    this.remove(key);
    logger.info({ operation: "product_projection_cache", event: "expiration" });
  }

  private remember(key: string, revision: number, value: unknown) {
    // A reader that began before a commit must not replace a newer entry when it finishes.
    if ((this.entries.get(key)?.revision ?? -1) >= revision) return;
    const weight = 256 + estimateAndFreeze(value);
    if (weight > maxEntryBytes) return;
    this.remove(key);
    while (this.bytes + weight > maxBytes || this.entries.size >= maxEntries) {
      this.remove(this.entries.keys().next().value!);
      logger.info({ operation: "product_projection_cache", event: "eviction" });
    }
    const expiresAt = performance.now() + ttlMs;
    const timer = setTimeout(() => this.expire(key), ttlMs);
    timer.unref();
    this.entries.set(key, { revision, value, weight, expiresAt, timer });
    this.bytes += weight;
  }

  private databaseKey({ db, keys }: ProductAccess) {
    return `${this.identity(db)}:${this.identity(keys)}`;
  }

  async read<T>(
    access: ProductAccess, projection: ProductProjection, revision: number, load: () => Promise<T>,
    fresh: (value: T) => boolean = () => true,
  ): Promise<CacheResult<T>> {
    const key = `revision:${this.databaseKey(access)}:${access.tenantId}:${projection}`;
    for (;;) {
      const result = await this.readKey(key, revision, load, fresh);
      if (result.cache !== "coalesced" || fresh(result.value)) return result;
    }
  }

  beginCommit(tenantId: string) {
    let commit = this.commits.get(tenantId);
    if (!commit) {
      const { promise, resolve } = Promise.withResolvers<void>();
      commit = { count: 0, done: promise, resolve };
      this.commits.set(tenantId, commit);
    }
    commit.count++;
    return (invalidate: boolean) => {
      if (invalidate) {
        const prefix = this.localPrefix(tenantId);
        for (const key of this.entries.keys()) {
          if (key.startsWith(prefix)) this.remove(key);
        }
        // Detach pre-commit loads from the next generation without releasing their in-flight budget.
        for (const key of this.pending.keys()) {
          if (key.startsWith(prefix)) this.pending.delete(key);
        }
      }
      if (--commit.count === 0) {
        this.commits.delete(tenantId);
        commit.resolve();
      }
    };
  }

  private localPrefix(tenantId: string) {
    return `local:${JSON.stringify(tenantId)}:`;
  }

  async readLocal<T extends ReadContext<unknown>>(
    access: ProductAccess, projection: ProductProjection | TaskListProjection, parameters: ProjectionParameters, load: () => Promise<T>,
    retain: (data: T["data"]) => boolean = () => true,
  ) {
    const key = `${this.localPrefix(access.tenantId)}${this.databaseKey(access)}:${projection}:${JSON.stringify(parameters)}`;
    const fresh = ({ calendar }: T) =>
      !calendar || calendar.referenceDate === referenceDate(calendar.timezone, Temporal.Now.instant());
    for (;;) {
      const commit = this.commits.get(access.tenantId);
      if (commit) {
        await commit.done;
        continue;
      }
      const result = await this.readKey(key, 0, load, fresh, (value) => fresh(value) && retain(value.data));
      if (fresh(result.value)) return result;
    }
  }

  private async readKey<T>(
    key: string, revision: number, load: () => Promise<T>, fresh: (value: T) => boolean,
    retain: (value: T) => boolean = () => true,
  ): Promise<CacheResult<T>> {
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.expiresAt <= performance.now()) this.expire(key);
      else if (entry.revision === revision && fresh(entry.value as T)) {
        this.entries.delete(key);
        this.entries.set(key, entry);
        return { value: entry.value as T, cache: "hit" };
      } else if (entry.revision <= revision) this.remove(key);
    }

    const flightKey = `${key}:${revision}`;
    const current = this.pending.get(flightKey);
    if (current) return { value: await current as T, cache: "coalesced" };
    if (this.inFlight >= maxEntries) return { value: await load(), cache: "bypass" };

    const pending = load();
    this.pending.set(flightKey, pending);
    this.inFlight++;
    try {
      const value = await pending;
      if (this.pending.get(flightKey) !== pending || !retain(value)) return { value, cache: "bypass" };
      try {
        this.remember(key, revision, value);
      } catch {
        this.remove(key);
        logger.warn({ operation: "product_projection_cache", event: "store_failure" });
        return { value, cache: "bypass" };
      }
      return { value, cache: "miss" };
    } finally {
      if (this.pending.get(flightKey) === pending) this.pending.delete(flightKey);
      this.inFlight--;
    }
  }
}

// Use the same budget and in-flight reads across Next.js route bundles in this process.
const processState = globalThis as typeof globalThis & { feitoProductProjectionCache?: ProductCache };
export const productCache = processState.feitoProductProjectionCache ??= new ProductCache();

export async function readLocalTaskList<T>(
  access: ProductAccess, projection: TaskListProjection, parameters: ProjectionParameters,
  load: () => Promise<{ data: T; calendar: ProductCalendar }>,
) {
  if (!usesLocalProductCache()) return (await load()).data;
  const start = performance.now();
  const { value, cache } = await productCache.readLocal(access, projection, parameters, load,
    (data) => !hasDescriptionExcerpt(data));
  logger.info({ operation: "product_list_cache_read", projection, cache,
    durationMs: Math.round((performance.now() - start) * 100) / 100 });
  return value.data;
}

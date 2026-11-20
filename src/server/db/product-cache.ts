import "server-only";
import { logger } from "@/server/logger";
import type { ProductAccess } from "./product";

export type ProductProjection = "navigation" | "projects:active" | "projects:archived" | "labels";

const ttlMs = 12 * 60 * 60_000;
const maxEntries = 64;
const maxBytes = 16 * 1024 * 1024;
const maxEntryBytes = 4 * 1024 * 1024;

type Entry = { revision: number; value: unknown; weight: number; expiresAt: number; timer: NodeJS.Timeout };
type CacheResult<T> = { value: T; cache: "hit" | "miss" | "coalesced" | "bypass" };

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

  async read<T>(
    access: ProductAccess, projection: ProductProjection, revision: number, load: () => Promise<T>,
    fresh: (value: T) => boolean = () => true,
  ): Promise<CacheResult<T>> {
    const { db, keys, tenantId } = access;
    const key = `${this.identity(db)}:${this.identity(keys)}:${tenantId}:${projection}`;
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
    if (current) {
      const value = await current as T;
      if (fresh(value)) return { value, cache: "coalesced" };
      return this.read(access, projection, revision, load, fresh);
    }
    if (this.pending.size >= maxEntries) return { value: await load(), cache: "bypass" };

    const pending = load();
    this.pending.set(flightKey, pending);
    try {
      const value = await pending;
      try {
        this.remember(key, revision, value);
      } catch {
        this.remove(key);
        logger.warn({ operation: "product_projection_cache", event: "store_failure" });
        return { value, cache: "bypass" };
      }
      return { value, cache: "miss" };
    } finally {
      this.pending.delete(flightKey);
    }
  }
}

// Use the same budget and in-flight reads across Next.js route bundles in this process.
const processState = globalThis as typeof globalThis & { feitoProductProjectionCache?: ProductCache };
export const productCache = processState.feitoProductProjectionCache ??= new ProductCache();

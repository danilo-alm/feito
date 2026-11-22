import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { readLegacyBrowserProfile } from "./legacy";
import { createProfileStorage } from "./profile-storage";
import { createSqliteStorage, migrateSqlite, queryFiles } from "./storage";
import { createSqliteProduct } from "./product";
import type { StorageRequest, StorageResponse, StorageValue } from "./protocol";

declare const sqliteMigrations: string[];
declare const sqliteQueries: Record<string, string>;

async function retryBusy<T>(perform: () => T | Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await perform();
    } catch (error) {
      const code = (error as { resultCode?: number }).resultCode;
      if (code === undefined || (code & 255) !== 5 || attempt >= 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1) + Math.random() * 30));
    }
  }
}

async function open() {
  const sqlite = await sqlite3InitModule();
  if (!globalThis.crossOriginIsolated || !sqlite.oo1.OpfsDb) throw new Error("SQLite OPFS is unavailable");
  const db = new sqlite.oo1.OpfsDb("/feito-workspace.sqlite3");
  try {
    db.exec("PRAGMA busy_timeout = 150; PRAGMA synchronous = FULL;");
    await retryBusy(() => migrateSqlite(db, sqlite.version.libVersionNumber, sqliteMigrations));
    const storage = createProfileStorage(db, sqliteQueries, location.origin);
    if (!await retryBusy(() => storage.summary())) {
      const legacy = await readLegacyBrowserProfile(indexedDB, location.origin);
      await retryBusy(() => storage.initialize(legacy));
    }
    const scoped = createSqliteStorage(db, Object.fromEntries(
      Object.entries(queryFiles).map(([key, file]) => [key, sqliteQueries[file]]),
    ) as Parameters<typeof createSqliteStorage>[1]);
    return { ...storage, product: createSqliteProduct(storage, scoped) };
  } catch (error) {
    db.close();
    throw error;
  }
}

let opening: ReturnType<typeof open> | undefined;
self.addEventListener("message", async ({ data }: MessageEvent<StorageRequest>) => {
  const { id, action } = data;
  let response: StorageResponse;
  try {
    const storage = await (opening ??= open().catch((error: unknown) => {
      opening = undefined;
      throw error;
    }));
    const value = await retryBusy<StorageValue | undefined>(() => {
      switch (action) {
        case "read": return storage.read();
        case "summary": return storage.summary();
        case "commit": return storage.commit(data.generation, data.update);
        case "product": return storage.product(data.request);
      }
    });
    if (value === undefined) throw new Error("Missing SQLite workspace selection");
    response = { id, value };
  } catch {
    response = { id, error: "Não foi possível acessar o armazenamento SQLite do Feito." };
  }
  postMessage(response);
});

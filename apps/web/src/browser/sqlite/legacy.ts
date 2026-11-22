import type { SQLiteProfile } from "@feito/core/product/sqlite-batches";
import type { Replica } from "@feito/core/product/replica";
import type { BrowserRecord, LocalSpace } from "../storage";

export const BROWSER_DATABASE = "feito-browser";

type LegacyMetadata = Pick<BrowserRecord, "generation" | "selection">;

/**
 * Capture the v1 IndexedDB source in one read transaction. The caller must
 * coordinate exclusive use of the legacy profile before copying it.
 */
export async function readLegacyBrowserProfile(factory: IDBFactory, origin: string): Promise<SQLiteProfile | undefined> {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) throw new Error("Invalid workspace origin");

  const db = await new Promise<IDBDatabase | undefined>((resolve, reject) => {
    const request = factory.open(BROWSER_DATABASE, 1);
    let missing = false;
    let blocked = false;
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () => missing ? resolve(undefined) : reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Close the other Feito tabs and try again"));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
  if (!db) return undefined;

  const records = new Map<string, unknown>();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("records", "readonly");
      const request = tx.objectStore("records").openCursor();
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Legacy workspace read interrupted"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        records.set(String(cursor.key), cursor.value);
        cursor.continue();
      };
    });
  } finally {
    db.close();
  }

  const metadata = records.get("meta") as LegacyMetadata | undefined;
  if (!metadata) {
    if (records.size === 0) return undefined;
    throw new Error("Missing legacy workspace selection");
  }
  const { generation, selection } = metadata;
  const { space } = selection;
  const spaceId = space.kind === "account" ? "account:" + space.user.id : space.kind === "local" ? "local" : undefined;
  if (space.kind === "local" && !records.has("local")) throw new Error("Missing selected legacy workspace");

  const local = records.get("local") as LocalSpace | undefined;
  const remotes = [...records].flatMap(([key, value]) => {
    if (!key.startsWith("account:")) return [];
    const replica = value as Replica;
    if (key !== "account:" + replica.user.id) throw new Error("Legacy account identity mismatch");
    return [{ ...replica, id: key, origin }];
  });
  return {
    selection: {
      generation, epoch: selection.epoch, spaceId, discoverSession: selection.discoverSession,
      revokeSession: selection.revokeSession,
    },
    local: local && { ...local, id: "local" },
    accountWithoutReplica: space.kind === "account" && spaceId && !records.has(spaceId)
      ? { id: spaceId, origin, user: space.user } : undefined,
    remotes,
  };
}

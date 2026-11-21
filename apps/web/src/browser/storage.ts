import type { Workspace } from "@feito/core/product/local-executor";
import type { Replica } from "@feito/core/product/replica";
import type { ImportResult, User } from "@feito/core/types";

export type Space = { kind: "none" } | { kind: "local" } | { kind: "account"; user: User };
export type LocalSpace = { workspace: Workspace; imports?: Record<string, { binding: string; result: ImportResult }> };
export type SpaceData = LocalSpace | Replica;
export type Selection = {
  epoch: string;
  space: Space;
  discoverSession: boolean;
  revokeSession?: string;
};
export type BrowserRecord = {
  generation: number;
  selection: Selection;
  data?: SpaceData;
};
export type BrowserUpdate = {
  selection?: Selection;
  data?: SpaceData;
  localIfMissing?: LocalSpace;
  deleteAccount?: string;
};
export type BrowserStorage = {
  read(): Promise<BrowserRecord>;
  commit(generation: number, update: BrowserUpdate): Promise<boolean>;
};

const DATABASE = "feito-browser";
const RECORDS = "records";
const META = "meta";
const LOCAL = "local";
const accountKey = (id: string) => "account:" + id;

type Metadata = Pick<BrowserRecord, "generation" | "selection">;

const initial: Metadata = {
  generation: 0,
  selection: { epoch: "", space: { kind: "none" }, discoverSession: true },
};

function selectedKey(space: Space) {
  if (space.kind === "account") return accountKey(space.user.id);
  if (space.kind === "local") return LOCAL;
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("A gravação no navegador foi interrompida."));
  });
}

export function createBrowserStorage(factory: () => IDBFactory = () => indexedDB): BrowserStorage {
  let opened: Promise<IDBDatabase> | undefined;

  function open() {
    if (opened) return opened;
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory().open(DATABASE, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore(RECORDS);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Outra aba está usando uma versão anterior dos dados do Feito."));
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          opened = undefined;
        };
        db.onclose = () => { opened = undefined; };
        resolve(db);
      };
    }).catch((error: unknown) => {
      opened = undefined;
      throw error;
    });
    return opened;
  }

  return {
    async read() {
      const tx = (await open()).transaction(RECORDS);
      const store = tx.objectStore(RECORDS);
      const meta: Metadata = (await result(store.get(META))) ?? initial;
      const key = selectedKey(meta.selection.space);
      return { ...meta, data: key ? await result(store.get(key)) : undefined };
    },

    async commit(generation, update) {
      const tx = (await open()).transaction(RECORDS, "readwrite", { durability: "strict" });
      const completed = done(tx);
      const store = tx.objectStore(RECORDS);
      try {
        const meta: Metadata = (await result(store.get(META))) ?? initial;
        if (meta.generation !== generation) {
          await completed;
          return false;
        }
        const selection = update.selection ?? meta.selection;
        const key = selectedKey(selection.space);
        if (update.data && key) store.put(update.data, key);
        if (update.localIfMissing && (await result(store.getKey(LOCAL))) === undefined) {
          store.put(update.localIfMissing, LOCAL);
        }
        if (update.deleteAccount) store.delete(accountKey(update.deleteAccount));
        store.put({ generation: generation + 1, selection } satisfies Metadata, META);
        await completed;
        return true;
      } catch (error) {
        try { tx.abort(); } catch { /* A transação pode já ter terminado. */ }
        await completed.catch(() => undefined);
        throw error;
      }
    },
  };
}

export function accountReplica(record: BrowserRecord) {
  return record.selection.space.kind === "account" ? record.data as Replica | undefined : undefined;
}

export function localSpace(record: BrowserRecord) {
  return record.selection.space.kind === "local" ? record.data as LocalSpace | undefined : undefined;
}

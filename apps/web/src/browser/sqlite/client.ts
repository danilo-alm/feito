import type { BrowserRecord, BrowserStorage, BrowserSummary, BrowserProductResult } from "../storage";
import type { StorageRequest, StorageResponse, StorageValue } from "./protocol";

export function createBrowserSqliteStorage(url: string): BrowserStorage {
  let worker: Worker | undefined;
  let sequence = 0;
  const pending = new Map<number, {
    resolve: (value: StorageValue) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  function finish() {
    worker?.terminate();
    worker = undefined;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error("A conexão com o SQLite foi interrompida."));
    }
    pending.clear();
  }

  function connect() {
    if (worker) return worker;
    const next = new Worker(url, { type: "module" });
    next.onmessage = ({ data }: MessageEvent<StorageResponse>) => {
      if (worker !== next) return;
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timer);
      if ("error" in data) request.reject(new Error(data.error));
      else request.resolve(data.value);
    };
    const onError = () => { if (worker === next) finish(); };
    next.onerror = onError;
    next.onmessageerror = onError;
    worker = next;
    return next;
  }

  function request(message: StorageRequest) {
    return new Promise<StorageValue>((resolve, reject) => {
      const connection = connect();
      const timer = setTimeout(finish, 30_000);
      pending.set(message.id, { resolve, reject, timer });
      try {
        connection.postMessage(message);
      } catch (error) {
        pending.delete(message.id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  return {
    summary: async () => await request({ id: sequence++, action: "summary" }) as BrowserSummary,
    product: async (product) => await request({ id: sequence++, action: "product", request: product }) as BrowserProductResult,
    read: async () => await request({ id: sequence++, action: "read" }) as BrowserRecord,
    commit: async (generation, update) => await request({ id: sequence++, action: "commit", generation, update }) as boolean,
  };
}

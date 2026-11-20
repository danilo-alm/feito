"use client";
import { useCallback, useEffect, useReducer } from "react";

type Entry = {
  base?: unknown;
  data?: unknown;
  error?: unknown;
  loading: boolean;
  seq: number;
  fetcher: () => Promise<unknown>;
  subscribers: Set<() => void>;
};

export type QueryData = Map<string, unknown>;
export type QueryProjection = (data: QueryData) => void;
type Layer = { predict: QueryProjection };
type Confirmation = { revision: number; apply: QueryProjection };

const cache = new Map<string, Entry>();
const pending = new Set<Layer>();
const confirmed: Confirmation[] = [];
const deferred = new Map<string, { promise: Promise<void>; resolve: () => void }>();

export function isTaskProjection(key: string) {
  return key === "nav" || key === "labels" || /^(project|task|today|upcoming|label|search):/.test(key);
}

function notify(entry: Entry) {
  for (const subscriber of entry.subscribers) subscriber();
}

function project() {
  const data = confirmedQueryData();
  for (const { predict } of pending) predict(data);
  return data;
}

function publish() {
  const data = project();
  for (const [key, entry] of cache) {
    const next = data.get(key);
    if (entry.data === next) continue;
    entry.data = next;
    notify(entry);
  }
}

function entryFor(key: string, fetcher: () => Promise<unknown>) {
  let entry = cache.get(key);
  if (!entry) {
    entry = { loading: false, seq: 0, fetcher, subscribers: new Set() };
    cache.set(key, entry);
  }
  entry.fetcher = fetcher;
  return entry;
}

function defer(key: string) {
  const current = deferred.get(key);
  if (current) return current.promise;
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  deferred.set(key, { promise, resolve });
  return promise;
}

function load(key: string): Promise<void> {
  const entry = cache.get(key);
  if (!entry) return Promise.resolve();
  // A GET can already contain an unacknowledged write. Keep it out of the
  // confirmed base until the mutations settle to avoid applying a delta twice.
  if (pending.size && isTaskProjection(key)) return defer(key);

  const seq = ++entry.seq;
  entry.loading = true;
  notify(entry);
  return entry.fetcher().then((data) => {
    if (seq !== entry.seq || cache.get(key) !== entry) return;
    entry.base = data;
    entry.error = undefined;
    publish();
  }, (error) => {
    if (seq !== entry.seq) return;
    entry.error = error;
  }).finally(() => {
    if (seq !== entry.seq) return;
    entry.loading = false;
    notify(entry);
  });
}

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>) {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const entry = key ? entryFor(key, fetcher) : undefined;

  useEffect(() => {
    if (!key) return;
    const current = entryFor(key, fetcher);
    current.subscribers.add(rerender);
    if (current.data === undefined && !current.loading) void load(key);
    return () => {
      current.subscribers.delete(rerender);
    };
    // O carregador mais recente fica guardado na entrada a cada renderização.
  }, [key]);

  const mutate = useCallback((update: (current: T | undefined) => T | undefined) => {
    if (key) setQueryData<T>(key, update);
  }, [key]);

  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: !!entry?.loading || !!(key && deferred.has(key)),
    reload: () => (key ? load(key) : Promise.resolve()),
    mutate,
  };
}

export function setQueryData<T>(key: string, update: (current: T | undefined) => T | undefined) {
  const entry = cache.get(key);
  if (!entry) return;
  entry.seq++;
  entry.loading = false;
  entry.base = update(entry.base as T | undefined);
  publish();
  notify(entry);
}

export function getQueryData<T>(key: string) {
  return cache.get(key)?.data as T | undefined;
}

export function confirmedQueryData(): QueryData {
  const data: QueryData = new Map([...cache].map(([key, entry]) => [key, entry.base]));
  for (const { apply } of confirmed) apply(data);
  return data;
}

export function appendQueryData<T>(key: string, update: (current: T) => Promise<T>) {
  const entry = cache.get(key);
  const base = entry?.base as T | undefined;
  if (!entry || base === undefined || pending.size) return Promise.resolve();
  return update(base).then((next) => {
    if (cache.get(key) === entry && entry.base === base && !pending.size) setQueryData<T>(key, () => next);
  });
}

export function beginProjection(predict: QueryProjection) {
  const layer = { predict };
  if (!pending.size) {
    for (const [key, entry] of cache) {
      if (!entry.loading || !isTaskProjection(key)) continue;
      entry.seq++;
      entry.loading = false;
      void defer(key);
    }
  }
  pending.add(layer);
  publish();

  return {
    active: () => pending.has(layer),
    confirm(confirmation: Confirmation, remaining?: QueryProjection) {
      if (!pending.has(layer)) return;
      confirmed.push(confirmation);
      confirmed.sort((a, b) => a.revision - b.revision);
      if (remaining) {
        layer.predict = remaining;
        publish();
      } else {
        this.finish();
      }
    },
    finish() {
      if (!pending.delete(layer)) return;
      if (pending.size) {
        publish();
        return;
      }
      // Fold overlapping responses in commit order, then resume any reads that were in flight.
      const data = project();
      confirmed.length = 0;
      for (const [key, entry] of cache) {
        const next = data.get(key);
        if (entry.base === next && entry.data === next) continue;
        entry.base = next;
        entry.data = next;
        notify(entry);
      }
      for (const [key, { resolve }] of deferred) {
        deferred.delete(key);
        void load(key).finally(resolve);
      }
    },
  };
}

/** Revalida as chaves visíveis e descarta as demais para recarregar quando montadas. */
export function invalidate(match: (key: string) => boolean = () => true) {
  const reads: Promise<unknown>[] = [];
  for (const [key, entry] of cache) {
    if (!match(key)) continue;
    if (entry.subscribers.size) reads.push(load(key));
    else cache.delete(key);
  }
  return Promise.all(reads);
}

export function clearCache() {
  cache.clear();
  pending.clear();
  confirmed.length = 0;
  for (const read of deferred.values()) read.resolve();
  deferred.clear();
}

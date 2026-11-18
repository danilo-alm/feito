"use client";
// Cache mínimo de leituras: cada chave tem um carregador, assinantes e revalidação sob demanda.
import { useCallback, useEffect, useReducer } from "react";

type Entry = {
  data?: unknown;
  error?: unknown;
  loading: boolean;
  seq: number;
  fetcher: () => Promise<unknown>;
  subscribers: Set<() => void>;
};

const cache = new Map<string, Entry>();

function notify(entry: Entry) {
  for (const subscriber of entry.subscribers) subscriber();
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

function load(key: string) {
  const entry = cache.get(key);
  if (!entry) return Promise.resolve();
  const seq = ++entry.seq;
  entry.loading = true;
  notify(entry);
  return entry.fetcher().then((data) => {
    if (seq !== entry.seq) return;
    entry.data = data;
    entry.error = undefined;
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
    loading: !!entry?.loading,
    reload: () => (key ? load(key) : Promise.resolve()),
    mutate,
  };
}

export function setQueryData<T>(key: string, update: (current: T | undefined) => T | undefined) {
  const entry = cache.get(key);
  if (!entry) return;
  entry.seq++; // descarta respostas antigas em andamento
  entry.loading = false;
  entry.data = update(entry.data as T | undefined);
  notify(entry);
}

export function getQueryData<T>(key: string) {
  return cache.get(key)?.data as T | undefined;
}

/** Revalida as chaves visíveis e descarta as demais para recarregar quando montadas. */
export function invalidate(match: (key: string) => boolean = () => true) {
  const pending: Promise<unknown>[] = [];
  for (const [key, entry] of cache) {
    if (!match(key)) continue;
    if (entry.subscribers.size) pending.push(load(key));
    else cache.delete(key);
  }
  return Promise.all(pending);
}

export function clearCache() {
  cache.clear();
}

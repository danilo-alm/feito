import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

const worker = readFileSync(new URL("../../src/offline/service-worker.js", import.meta.url), "utf8");
const origin = "https://feito.test";
const cacheName = "feito:static:Atual";
const shell = "/_next/static/Atual/feito-shell.html";
const chunk = "/_next/static/chunks/telas.js";

function setup() {
  const assets = new Map<string, Response>();
  const caches = new Set(["feito:static:Anterior", "outro-app"]);
  const claim = vi.fn(async () => undefined);
  const skipWaiting = vi.fn();
  let online = true;
  const addAll = vi.fn(async (requests: Request[]) => {
    if (!online) throw new Error("Sem conexão");
    for (const request of requests) assets.set(request.url, new Response(request.url.endsWith(shell) ? "Entrada genérica" : "Arquivo estático"));
  });
  const handlers = new Map<string, (event: object) => void>();
  runInNewContext(worker, {
    packageFiles: { build: "Atual", shell, entries: [shell, chunk].map((url) => ({ url, integrity: "sha256-teste" })) },
    self: { location: { origin }, clients: { claim }, skipWaiting, addEventListener: (name: string, handle: (event: object) => void) => handlers.set(name, handle) },
    Request: class extends Request { constructor(url: string, init: RequestInit) { super(new URL(url, origin), init); } },
    Response, Headers, URL,
    fetch: async () => { if (!online) throw new Error("Sem conexão"); return new Response("Resposta da rede"); },
    caches: {
      keys: async () => [...caches],
      delete: async (name: string) => caches.delete(name),
      open: async (name: string) => {
        caches.add(name);
        return { addAll, keys: async () => [...assets.keys()].map((url) => ({ url })), match: async (path: string) => assets.get(origin + path)?.clone() };
      },
    },
  });
  function lifecycle(name: "install" | "activate") {
    let result: Promise<void> | undefined;
    handlers.get(name)?.({ waitUntil: (promise: Promise<void>) => { result = promise; } });
    return result;
  }
  function fetch(path: string, mode: RequestMode = "navigate", init?: RequestInit) {
    let result: Promise<Response> | undefined;
    const request = { url: new URL(path, origin).href, mode, method: init?.method ?? "GET", headers: new Headers(init?.headers) };
    handlers.get("fetch")?.({ request, respondWith: (promise: Promise<Response>) => { result = promise; } });
    return result;
  }
  return { lifecycle, fetch, assets, caches, claim, skipWaiting, addAll, setOnline: (value: boolean) => { online = value; } };
}

test("prepara somente o pacote público e mantém a versão anterior até ativar", async () => {
  const env = setup();
  await env.lifecycle("install");
  expect(env.caches).toEqual(new Set([cacheName, "feito:static:Anterior", "outro-app"]));
  expect(env.skipWaiting).not.toHaveBeenCalled();
  expect(env.addAll).toHaveBeenCalledTimes(1);
  expect(env.addAll.mock.calls[0][0].map((request) => [request.url, request.credentials, request.redirect, request.integrity]))
    .toEqual([shell, chunk].map((path) => [origin + path, "omit", "error", "sha256-teste"]));
  await env.lifecycle("activate");
  expect(env.caches).toEqual(new Set([cacheName, "outro-app"]));
  expect(env.claim).toHaveBeenCalledOnce();
});

test("abre links locais offline e deixa API, compartilhamento e RSC seguirem pela rede", async () => {
  const env = setup();
  await env.lifecycle("install");
  env.setOnline(false);
  expect(await (await env.fetch("/projetos/um-id?tarefa=outra"))?.text()).toBe("Entrada genérica");
  expect(await (await env.fetch(chunk, "cors"))?.text()).toBe("Arquivo estático");
  expect(env.fetch("/compartilhado/token")).toBeUndefined();
  expect(env.fetch("/api/v1/auth/session", "cors")).toBeUndefined();
  expect(env.fetch("/api/v1/desktop-sync", "cors", { method: "POST" })).toBeUndefined();
  expect(env.fetch("/hoje?_rsc=abc", "cors")).toBeUndefined();
  expect(env.fetch("/hoje", "cors", { headers: { RSC: "1" } })).toBeUndefined();
  expect(env.fetch("https://outra-origem.test/hoje")).toBeUndefined();
});

test("recupera o conjunto de arquivos quando o navegador perde parte do cache", async () => {
  const env = setup();
  await env.lifecycle("install");
  env.assets.delete(origin + chunk);
  env.setOnline(false);
  const unavailable = await env.fetch("/ajustes");
  expect(unavailable?.status).toBe(503);
  expect(await unavailable?.text()).toContain("O Feito precisa de conexão");
  env.setOnline(true);
  expect(await (await env.fetch("/ajustes"))?.text()).toBe("Entrada genérica");
  expect(env.assets.has(origin + chunk)).toBe(true);
});

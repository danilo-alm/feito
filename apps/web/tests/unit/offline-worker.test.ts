import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

const worker = readFileSync(new URL("../../src/offline/service-worker.js", import.meta.url), "utf8");
const origin = "https://feito.test";
const cacheName = "feito:static:Atual";
const shell = "/_next/static/Atual/feito-shell.html";
const chunk = "/_next/static/chunks/telas.js";

type Lifecycle = (name: "install" | "activate") => Promise<void> | undefined;

// Um navegador com Cache Storage compartilhado entre as versões do worker, como na origem real.
function browser() {
  const storage = new Map<string, Map<string, Response>>();
  const windows: { id: string; url: string }[] = [];
  let online = true;
  function open(name: string) {
    const entries = storage.get(name) ?? new Map<string, Response>();
    storage.set(name, entries);
    return entries;
  }
  function install(build: string) {
    const files = [`/_next/static/${build}/feito-shell.html`, chunk, `/_next/static/${build}/tela.js`, "/icon.svg"];
    const claim = vi.fn(async () => undefined);
    const skipWaiting = vi.fn(async () => undefined);
    const addAll = vi.fn();
    const handlers = new Map<string, (event: object) => void>();
    runInNewContext(worker, {
      packageFiles: { build, shell: files[0], entries: files.map((url) => ({ url, integrity: "sha256-teste" })) },
      self: {
        location: { origin }, skipWaiting, clients: { claim, matchAll: async () => windows },
        addEventListener: (name: string, handle: (event: object) => void) => handlers.set(name, handle),
      },
      Request: class extends Request { constructor(url: string, init: RequestInit) { super(new URL(url, origin), init); } },
      Response, Headers, URL,
      fetch: async () => { if (!online) throw new Error("Sem conexão"); return new Response("Resposta da rede"); },
      caches: {
        keys: async () => [...storage.keys()],
        delete: async (name: string) => storage.delete(name),
        open: async (name: string) => {
          const entries = open(name);
          return {
            keys: async () => [...entries.keys()].map((url) => ({ url })),
            match: async (path: string) => entries.get(origin + path)?.clone(),
            put: async (path: string, response: Response) => { entries.set(origin + path, response); },
            addAll: async (requests: Request[]) => {
              addAll(requests);
              if (!online) throw new Error("Sem conexão");
              for (const request of requests) {
                entries.set(request.url, new Response(request.url.endsWith("feito-shell.html") ? `Entrada ${build}` : `Arquivo ${build}`));
              }
            },
          };
        },
      },
    });
    const lifecycle: Lifecycle = (name) => {
      let result: Promise<void> | undefined;
      handlers.get(name)?.({ waitUntil: (promise: Promise<void>) => { result = promise; } });
      return result;
    };
    function fetch(path: string, mode: RequestMode = "navigate", init?: RequestInit) {
      let result: Promise<Response> | undefined;
      const request = { url: new URL(path, origin).href, mode, method: init?.method ?? "GET", headers: new Headers(init?.headers) };
      handlers.get("fetch")?.({ request, respondWith: (promise: Promise<Response>) => { result = promise; } });
      return result;
    }
    async function send(data: unknown, from = "/hoje", id = "esta") {
      let answer: unknown;
      let done: Promise<void> | undefined;
      handlers.get("message")?.({
        data, source: { id, url: origin + from }, ports: [{ postMessage: (value: unknown) => { answer = value; } }],
        waitUntil: (promise: Promise<void>) => { done = promise; },
      });
      await done;
      return answer;
    }
    return { lifecycle, fetch, send, claim, skipWaiting, addAll };
  }
  return {
    install, open, storage, windows, setOnline: (value: boolean) => { online = value; },
    text: async (response: Promise<Response> | undefined) => (await response)?.text(),
  };
}

async function setup() {
  const env = browser();
  env.open("feito:static:Anterior");
  env.open("outro-app");
  const current = env.install("Atual");
  return { ...env, ...current, assets: env.open(cacheName) };
}

// Primeira instalação seguida de um deploy: a versão aceita continua sendo a primeira.
async function deployed() {
  const env = browser();
  const first = env.install("Um");
  await first.lifecycle("install");
  await first.lifecycle("activate");
  const second = env.install("Dois");
  await second.lifecycle("install");
  await second.lifecycle("activate");
  return { ...env, first, second };
}

test("prepara somente o pacote público e mantém a versão anterior até ativar", async () => {
  const env = await setup();
  await env.lifecycle("install");
  expect([...env.storage.keys()]).toEqual(expect.arrayContaining([cacheName, "feito:static:Anterior", "outro-app"]));
  // Sem versão aceita registrada, as abas do worker anterior precisam fechar antes.
  expect(env.skipWaiting).not.toHaveBeenCalled();
  expect(env.addAll).toHaveBeenCalledTimes(1);
  expect(env.addAll.mock.calls[0][0].map((request: Request) => [request.url, request.credentials, request.redirect, request.integrity]))
    .toEqual([shell, chunk, "/_next/static/Atual/tela.js", "/icon.svg"].map((path) => [origin + path, "omit", "error", "sha256-teste"]));
  await env.lifecycle("activate");
  expect(env.storage.has("feito:static:Anterior")).toBe(false);
  expect(env.storage.has("outro-app")).toBe(true);
  expect(env.claim).toHaveBeenCalledOnce();
});

test("abre links locais offline e deixa API, compartilhamento e RSC seguirem pela rede", async () => {
  const env = await setup();
  await env.lifecycle("install");
  env.setOnline(false);
  expect(await env.text(env.fetch("/projetos/um-id?tarefa=outra"))).toBe("Entrada Atual");
  expect(await env.text(env.fetch(chunk, "cors"))).toBe("Arquivo Atual");
  expect(env.fetch("/compartilhado/token")).toBeUndefined();
  expect(env.fetch("/api/v1/auth/session", "cors")).toBeUndefined();
  expect(env.fetch("/api/v1/desktop-sync", "cors", { method: "POST" })).toBeUndefined();
  expect(env.fetch("/hoje?_rsc=abc", "cors")).toBeUndefined();
  expect(env.fetch("/hoje", "cors", { headers: { RSC: "1" } })).toBeUndefined();
  expect(env.fetch("https://outra-origem.test/hoje")).toBeUndefined();
});

test("recupera o conjunto de arquivos quando o navegador perde parte do cache", async () => {
  const env = await setup();
  await env.lifecycle("install");
  env.assets.delete(origin + chunk);
  env.setOnline(false);
  const unavailable = await env.fetch("/ajustes");
  expect(unavailable?.status).toBe(503);
  const fallback = await unavailable?.text();
  expect(fallback).toContain('<html lang="en">');
  expect(fallback).toContain("<h1>Feito needs a connection</h1>");
  env.setOnline(true);
  expect(await env.text(env.fetch("/ajustes"))).toBe("Entrada Atual");
  expect(env.assets.has(origin + chunk)).toBe(true);
});

test("mantém a URL da requisição para módulos de worker com configuração na query", async () => {
  const env = await setup();
  await env.lifecycle("install");
  env.assets.set(origin + chunk, new Response("Worker", {
    headers: {
      "Content-Type": "text/javascript",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Content-Encoding": "gzip",
      "Content-Length": "100",
    },
  }));
  env.setOnline(false);
  const response = await env.fetch(chunk + "?vfs=opfs", "same-origin");
  expect(response?.url).toBe("");
  expect(response?.headers.get("Content-Type")).toBe("text/javascript");
  expect(response?.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
  expect(response?.headers.has("Content-Encoding")).toBe(false);
  expect(await response?.text()).toBe("Worker");
});

test("uma versão nova só entra em uso quando a pessoa pede", async () => {
  const env = await deployed();
  expect(env.second.skipWaiting).toHaveBeenCalledOnce();
  expect(env.storage.has("feito:static:Um")).toBe(true);
  env.setOnline(false);
  // O worker novo continua servindo a versão aceita, mesmo depois de todas as abas fecharem.
  expect(await env.text(env.second.fetch("/hoje"))).toBe("Entrada Um");
  expect(await env.text(env.second.fetch("/_next/static/Um/tela.js", "cors"))).toBe("Arquivo Um");
  expect(await env.text(env.second.fetch("/_next/static/Dois/tela.js", "cors"))).toBe("Arquivo Dois");
  expect(await env.second.send({ type: "feito:version", build: "Um" })).toEqual({ update: true });
  expect(await env.second.send("feito:prepare-offline")).toBe(true);

  expect(await env.second.send("feito:update")).toBe("ready");
  expect(await env.text(env.second.fetch("/hoje"))).toBe("Entrada Dois");
  expect(env.storage.has("feito:static:Um")).toBe(false);
  expect(await env.second.send({ type: "feito:version", build: "Dois" })).toEqual({ update: false });
});

test("ativa o worker que ficou esperando somente quando há uma versão aceita", async () => {
  const env = browser();
  const first = env.install("Um");
  await first.lifecycle("install");
  await first.send("feito:activate");
  expect(first.skipWaiting).not.toHaveBeenCalled();
  await first.lifecycle("activate");
  const second = env.install("Dois");
  await second.lifecycle("install");
  await second.send("feito:activate");
  expect(second.skipWaiting).toHaveBeenCalledTimes(2);
});

test("atualiza somente sem outras abas do app abertas", async () => {
  const env = await deployed();
  env.windows.push({ id: "esta", url: origin + "/ajustes" }, { id: "publica", url: origin + "/compartilhado/token" },
    { id: "outra", url: origin + "/projetos/um-id" });
  expect(await env.second.send("feito:update")).toBe("tabs");
  expect(await env.text(env.second.fetch("/hoje"))).toBe("Entrada Um");
  env.windows.pop();
  expect(await env.second.send("feito:update")).toBe("ready");
  expect(await env.text(env.second.fetch("/hoje"))).toBe("Entrada Dois");
});

test("mantém a versão aceita ao passar por vários deploys sem atualizar", async () => {
  const env = await deployed();
  const third = env.install("Tres");
  await third.lifecycle("install");
  await third.lifecycle("activate");
  expect(env.storage.has("feito:static:Um")).toBe(true);
  expect(env.storage.has("feito:static:Dois")).toBe(false);
  expect(await env.text(third.fetch("/hoje"))).toBe("Entrada Um");
});

test("acompanha uma tela do app que já chegou do servidor na versão nova", async () => {
  const env = await deployed();
  // Projetos compartilhados vêm sempre da rede e não abrem os dados locais.
  expect(await env.second.send({ type: "feito:version", build: "Dois" }, "/compartilhado/token")).toEqual({ update: true });
  expect(await env.text(env.second.fetch("/hoje"))).toBe("Entrada Um");
  expect(await env.second.send({ type: "feito:version", build: "Dois" }, "/entrada")).toEqual({ update: false });
  expect(await env.text(env.second.fetch("/hoje"))).toBe("Entrada Dois");
});

test("usa a versão nova quando o navegador perde arquivos da versão aceita", async () => {
  const env = await deployed();
  env.open("feito:static:Um").delete(origin + "/_next/static/Um/tela.js");
  env.setOnline(false);
  expect(await env.text(env.second.fetch("/hoje"))).toBe("Entrada Dois");
  expect(env.storage.has("feito:static:Um")).toBe(false);
});

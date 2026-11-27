/* global packageFiles */

const cachePrefix = "feito:static:";
const cacheName = cachePrefix + packageFiles.build;
// Guarda a versão aceita neste navegador. Ela só muda quando a pessoa pede a atualização.
const stateName = "feito:version";
const pinnedKey = "/__feito/pinned";
const manifestKey = "/__feito/manifest";
const publicFiles = new Set(packageFiles.entries.map(({ url }) => url).filter((url) => !url.startsWith("/_next/static/")));
const workspacePaths = new Set(["/", "/navegador", "/entrar", "/trocar-senha", "/entrada", "/hoje", "/em-breve", "/navegar", "/busca", "/ajustes"]);
let preparing;

async function openPackage() {
  const cache = await caches.open(cacheName);
  const existing = new Set((await cache.keys()).map(({ url }) => new URL(url).pathname));
  const complete = packageFiles.entries.every(({ url }) => existing.has(url));
  if (!complete) {
    await cache.addAll(packageFiles.entries.map(({ url, integrity }) => new Request(url, {
      integrity, credentials: "omit", redirect: "error", cache: "reload", mode: "same-origin",
    })));
  }
  // Uma versão posterior do worker usa esta lista para saber se os arquivos continuam inteiros.
  if (!complete || !existing.has(manifestKey)) {
    await cache.put(manifestKey, new Response(JSON.stringify({ shell: packageFiles.shell, files: packageFiles.entries.map(({ url }) => url) })));
  }
  return cache;
}

function preparePackage() {
  preparing ??= openPackage().finally(() => { preparing = undefined; });
  return preparing;
}

async function readPinned() {
  const stored = await (await caches.open(stateName)).match(pinnedKey);
  return stored?.text();
}

async function pin(build) {
  await (await caches.open(stateName)).put(pinnedKey, new Response(build));
}

async function adopt(previous) {
  await preparePackage();
  await pin(packageFiles.build);
  await caches.delete(cachePrefix + previous);
}

async function acceptedPackage() {
  const pinned = await readPinned();
  if (!pinned || pinned === packageFiles.build) return { cache: await preparePackage(), shell: packageFiles.shell };
  const cache = await caches.open(cachePrefix + pinned);
  const manifest = await (await cache.match(manifestKey))?.json();
  if (manifest) {
    const existing = new Set((await cache.keys()).map(({ url }) => new URL(url).pathname));
    if (manifest.files.every((url) => existing.has(url))) return { cache, shell: manifest.shell };
  }
  // O servidor já não fornece os arquivos antigos: sem o conjunto inteiro, resta a versão nova.
  await adopt(pinned);
  return { cache: await preparePackage(), shell: packageFiles.shell };
}

function isWorkspace({ pathname }) {
  const path = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  return workspacePaths.has(path) || /^\/(projetos|etiquetas)\/[^/]+$/.test(path);
}

async function checkVersion(running, source) {
  const pinned = await readPinned();
  if (!pinned || pinned === packageFiles.build) return { update: false };
  // Uma tela aberta direto do servidor (recarga forçada) já roda a versão nova e pode ter migrado
  // o banco local. A versão anterior deixaria de abrir esses dados.
  if (running === packageFiles.build && source && isWorkspace(new URL(source.url))) {
    await adopt(pinned);
    return { update: false };
  }
  return { update: true };
}

async function applyUpdate(sender) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (windows.some((client) => client.id !== sender && isWorkspace(new URL(client.url)))) return "tabs";
  const pinned = await readPinned();
  if (pinned && pinned !== packageFiles.build) await adopt(pinned);
  return "ready";
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await preparePackage();
    // Com uma versão aceita registrada, o worker novo pode assumir logo: ele continua servindo essa versão.
    // Sem registro (worker anterior a este controle), espera as abas antigas fecharem.
    if (await readPinned()) await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    let pinned = await readPinned();
    if (!pinned) await pin(pinned = packageFiles.build);
    const keep = new Set([cacheName, cachePrefix + pinned]);
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(cachePrefix) && !keep.has(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const { data, source } = event;
  // O navegador pode adiar o skipWaiting pedido na instalação. A página repete o pedido depois.
  if (data === "feito:activate") {
    event.waitUntil(readPinned().then((pinned) => pinned && self.skipWaiting()));
    return;
  }
  const port = event.ports[0];
  if (!port) return;
  let answer;
  let failure = false;
  if (data === "feito:prepare-offline") answer = acceptedPackage().then(() => true);
  else if (data?.type === "feito:version") answer = checkVersion(data.build, source);
  else if (data === "feito:update") [answer, failure] = [applyUpdate(source?.id), "failed"];
  else return;
  // As páginas de uma versão aceita falam com workers mais novos: mantenha estas mensagens compatíveis.
  event.waitUntil(answer.then((value) => port.postMessage(value), () => port.postMessage(failure)));
});

async function serveShell(request) {
  try {
    const accepted = await acceptedPackage();
    const shell = await accepted.cache.match(accepted.shell);
    if (shell) {
      // A URL que o app recebe é a do link aberto, inclusive em recargas profundas.
      const headers = new Headers(shell.headers);
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      headers.delete("Content-Encoding");
      headers.delete("Content-Length");
      return new Response(shell.body, { headers });
    }
  } catch {
    // Armazenamento indisponível ou pacote incompleto. A navegação online continua possível.
  }
  try {
    return await fetch(request);
  } catch {
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Feito</title><main><h1>Feito needs a connection</h1><p>Connect to the internet and reload this page to prepare offline access.</p></main><script>try{var l=localStorage.getItem("feito:locale"),m={"pt-BR":["O Feito precisa de conexão","Conecte-se à internet e recarregue esta página para preparar o acesso offline."],"pt-PT":["O Feito precisa de ligação","Ligue-se à internet e recarregue esta página para preparar o acesso offline."],en:["Feito needs a connection","Connect to the internet and reload this page to prepare offline access."],es:["Feito necesita conexión","Conéctate a internet y recarga esta página para preparar el acceso sin conexión."],fr:["Feito a besoin d’une connexion","Connectez-vous à Internet et rechargez cette page pour préparer l’accès hors ligne."],it:["Feito ha bisogno di una connessione","Connettiti a internet e ricarica questa pagina per preparare l’accesso offline."],de:["Feito braucht eine Verbindung","Verbinde dich mit dem Internet und lade diese Seite neu, um den Offlinezugriff vorzubereiten."]};m=Object.prototype.hasOwnProperty.call(m,l)?m[l]:null;if(m){document.documentElement.lang=l;document.querySelector("h1").textContent=m[0];document.querySelector("p").textContent=m[1]}}catch{}</script></html>`, {
      status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

async function serveAsset(request, path) {
  try {
    const pinned = await readPinned();
    // A versão aceita vem primeiro. As telas que chegam pela rede usam os arquivos da versão nova.
    const asset = (pinned && await (await caches.open(cachePrefix + pinned)).match(path))
      || await (await caches.open(cacheName)).match(path);
    if (asset) {
      if (!new URL(request.url).search) return asset;
      // The cached response URL omits the query. Workers use their script URL
      // for configuration, so let Fetch retain the URL of the original request.
      const headers = new Headers(asset.headers);
      headers.delete("Content-Encoding");
      headers.delete("Content-Length");
      return new Response(asset.body, { status: asset.status, headers });
    }
  } catch {
    // O servidor ainda pode fornecer o arquivo público.
  }
  return fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.searchParams.has("_rsc") || request.headers.has("RSC")) return;
  if (request.mode === "navigate") {
    if (isWorkspace(url)) event.respondWith(serveShell(request));
  } else if (url.pathname.startsWith("/_next/static/") || publicFiles.has(url.pathname)) {
    event.respondWith(serveAsset(request, url.pathname));
  }
});

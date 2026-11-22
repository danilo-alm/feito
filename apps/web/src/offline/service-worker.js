/* global packageFiles */

const cachePrefix = "feito:static:";
const cacheName = cachePrefix + packageFiles.build;
const paths = new Set(packageFiles.entries.map(({ url }) => url));
const workspacePaths = new Set(["/", "/navegador", "/entrar", "/trocar-senha", "/entrada", "/hoje", "/em-breve", "/navegar", "/busca", "/ajustes"]);
let preparing;

async function openPackage() {
  const cache = await caches.open(cacheName);
  const existing = new Set((await cache.keys()).map(({ url }) => new URL(url).pathname));
  if (packageFiles.entries.some(({ url }) => !existing.has(url))) {
    await cache.addAll(packageFiles.entries.map(({ url, integrity }) => new Request(url, {
      integrity, credentials: "omit", redirect: "error", cache: "reload", mode: "same-origin",
    })));
  }
  return cache;
}

function preparePackage() {
  preparing ??= openPackage().finally(() => { preparing = undefined; });
  return preparing;
}

self.addEventListener("install", (event) => {
  event.waitUntil(preparePackage());
  // O navegador mantém a versão anterior até sair a última aba que a usa.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data !== "feito:prepare-offline" || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil(preparePackage().then(() => port.postMessage(true), () => port.postMessage(false)));
});

async function serveShell(request) {
  try {
    const cache = await preparePackage();
    const shell = await cache.match(packageFiles.shell);
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
    const cache = await caches.open(cacheName);
    const asset = await cache.match(path);
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
    const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
    if (workspacePaths.has(path) || /^\/(projetos|etiquetas)\/[^/]+$/.test(path)) event.respondWith(serveShell(request));
  } else if (paths.has(url.pathname)) {
    event.respondWith(serveAsset(request, url.pathname));
  }
});

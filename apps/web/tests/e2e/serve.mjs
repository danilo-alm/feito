import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import next from "next";

const hostname = "127.0.0.1";
const port = Number(process.env.FEITO_E2E_PORT);
const app = next({ dev: false, hostname, port });
await app.prepare();

const handle = app.getRequestHandler();
let workerUpdate = false;

createServer({
  key: readFileSync(process.env.FEITO_E2E_KEY),
  cert: readFileSync(process.env.FEITO_E2E_CERT),
}, (request, response) => {
  const url = new URL(request.url, `https://${hostname}:${port}`);
  // Simula um deploy durante o teste sem alterar os arquivos servidos pelo Next.
  if (url.pathname === "/__e2e/worker-update" && request.method === "POST") {
    workerUpdate = url.searchParams.get("active") === "1";
    response.writeHead(204).end();
  } else if (workerUpdate && url.pathname === "/service-worker.js") {
    const next = readFileSync("public/service-worker.js", "utf8").replace(/"build":"([^"]+)"/, '"build":"$1-e2e"');
    response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" }).end(next);
  } else {
    void handle(request, response);
  }
}).listen(port, hostname);

import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import next from "next";

const hostname = "127.0.0.1";
const port = Number(process.env.FEITO_E2E_PORT);
const app = next({ dev: false, hostname, port });
await app.prepare();

createServer({
  key: readFileSync(process.env.FEITO_E2E_KEY),
  cert: readFileSync(process.env.FEITO_E2E_CERT),
}, app.getRequestHandler()).listen(port, hostname);

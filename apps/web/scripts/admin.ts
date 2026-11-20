import "server-only";
import { createHmac } from "node:crypto";
import { userInfo } from "node:os";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import pino from "pino";
import { email as canonicalEmail } from "@/validation/account";
import { readAuthConfig } from "@/server/crypto/config";
import { connectDatabase } from "@/server/db/client";
import { ApiError } from "@/server/errors";
import { administerAccount, createAccount, listAccounts, type AccountAction } from "@/server/services/admin";

const commands = [
  "account:create", "account:list", "account:reset-password", "account:revoke-sessions",
  "account:disable", "account:enable",
] as const;
type Command = typeof commands[number];
const audit = pino({ base: null }, process.stderr);

function usage() {
  process.stderr.write(`Uso: pnpm admin <${commands.join(" | ")}> [--email endereço]\n`);
}

function promptPassword() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new ApiError(400, "TTY_REQUIRED", "Execute o comando em um terminal interativo.");
  }
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const terminal = createInterface({ input: process.stdin, output: silent, terminal: true, historySize: 0 });
  process.stderr.write("Senha provisória: ");
  return new Promise<string>((resolve, reject) => {
    terminal.once("close", () => {
      process.stderr.write("\n");
      reject(new ApiError(400, "CANCELLED", "Operação cancelada."));
    });
    terminal.once("SIGINT", () => terminal.close());
    terminal.question("", (answer) => {
      resolve(answer);
      terminal.close();
    });
  });
}

async function main() {
  const options = { email: { type: "string" } } as const;
  const parse = () => parseArgs({ allowPositionals: true, options });
  let args: ReturnType<typeof parse>;
  try {
    args = parse();
  } catch {
    usage();
    return 1;
  }

  const action = commands.find((command) => command === args.positionals[0]);
  const email = canonicalEmail.safeParse(args.values.email);
  if (!action || args.positionals.length !== 1 ||
      (action === "account:list" ? args.values.email !== undefined : !email.success)) {
    usage();
    return 1;
  }

  return runCommand(action, email.data);
}

async function runCommand(action: Command, email?: string) {
  const operator = userInfo().username;
  let targetRef: string | undefined;
  let targetId: string | undefined;
  let close: (() => Promise<void>) | undefined;
  try {
    const config = readAuthConfig();
    if (email) targetRef = createHmac("sha256", config.secret).update(`audit:${email}`).digest("hex");
    const connection = connectDatabase("IDENTITY_ADMIN_DATABASE_URL", 1);
    close = connection.close;
    const store = { db: connection.db, config };

    if (action === "account:list") {
      // Explicit CLI output for the operator. Pino audit entries contain no email.
      for (const row of await listAccounts(store)) {
        process.stdout.write(`${row.email}\t${row.enabled ? "ativa" : "desativada"}\t${row.createdAt.toISOString()}\n`);
      }
    } else if (action === "account:create") {
      targetId = await createAccount(store, email!, await promptPassword());
    } else {
      const password = action === "account:reset-password" ? await promptPassword() : undefined;
      targetId = await administerAccount(store, action as AccountAction, email!, password);
    }

    audit.info({ operation: action, operator, targetId, result: "ok" });
    return 0;
  } catch (error) {
    const known = error instanceof ApiError;
    audit.warn({ operation: action, operator, targetRef, result: "failed", code: known ? error.code : "ADMIN_ERROR" });
    process.stderr.write(`${known ? error.message : "Não foi possível executar o comando administrativo."}\n`);
    return 1;
  } finally {
    await close?.();
  }
}

main().then((status) => {
  process.exitCode = status;
}).catch(() => {
  process.stderr.write("Não foi possível executar o comando administrativo.\n");
  process.exitCode = 1;
});

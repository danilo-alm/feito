import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Contas e sessões de teste ficam fora do Git e são recriadas a cada execução.
export const AUTH_DIR = join(process.cwd(), "tests", "e2e", ".auth");
export const ACCOUNTS_FILE = join(AUTH_DIR, "accounts.json");

function create(email: string, password: string) {
  execFileSync(process.execPath, ["--conditions=react-server", "--import=tsx", "tests/e2e/create-account.ts", email], {
    env: { ...process.env, FEITO_E2E_PASSWORD: password }, stdio: ["ignore", "ignore", "inherit"],
  });
}

async function activate(base: string, email: string, provisional: string, password: string) {
  const origin = new URL(base).origin;
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email, password: provisional }),
  });
  if (!login.ok) throw new Error(`Login de preparação falhou: ${login.status}`);
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const change = await fetch(`${base}/api/v1/auth/password`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
    body: JSON.stringify({ currentPassword: provisional, newPassword: password }),
  });
  if (change.status !== 204) throw new Error(`Troca de senha de preparação falhou: ${change.status}`);
}

export default async function globalSetup() {
  const base = process.env.FEITO_E2E_URL ?? "https://127.0.0.1:3100";
  const secret = () => randomBytes(18).toString("base64url");
  const fresh = { email: `novo-${randomUUID()}@feito.test`, password: secret() };
  create(fresh.email, fresh.password);
  const accounts: Record<string, { email: string; password: string }> = { fresh };
  for (const name of ["desktop", "celular"]) {
    const account = { email: `${name}-${randomUUID()}@feito.test`, password: secret() };
    const provisional = secret();
    create(account.email, provisional);
    await activate(base, account.email, provisional, account.password);
    accounts[name] = account;
  }
  rmSync(AUTH_DIR, { recursive: true, force: true });
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts), { mode: 0o600 });
}

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "@playwright/test";

// Contas e sessões de teste ficam fora do Git e são recriadas a cada execução.
export const AUTH_DIR = join(process.cwd(), "tests", "e2e", ".auth");
export const ACCOUNTS_FILE = join(AUTH_DIR, "accounts.json");
export const sessionFile = (name: string) => join(AUTH_DIR, `state-${name}.json`);

function create(email: string, password: string) {
  execFileSync(process.execPath, ["--conditions=react-server", "--import=tsx", "tests/e2e/create-account.ts", email], {
    env: { ...process.env, FEITO_E2E_PASSWORD: password }, stdio: ["ignore", "ignore", "inherit"],
  });
}

async function activate(base: string, name: string, email: string, provisional: string, password: string) {
  const client = await request.newContext({
    baseURL: base, extraHTTPHeaders: { Origin: new URL(base).origin },
  });
  try {
    const login = await client.post("/api/v1/auth/login", { data: { email, password: provisional } });
    if (!login.ok()) throw new Error(`Login de preparação falhou: ${login.status()}`);
    const change = await client.post("/api/v1/auth/password", {
      data: { currentPassword: provisional, newPassword: password },
    });
    if (change.status() !== 204) throw new Error(`Troca de senha de preparação falhou: ${change.status()}`);
    // Existing interaction scenarios explicitly exercise Portuguese.
    const preferences = await client.patch("/api/v1/preferences", { data: { locale: "pt-BR" } });
    if (!preferences.ok()) throw new Error(`Preferências de preparação falharam: ${preferences.status()}`);
    writeFileSync(sessionFile(name), JSON.stringify(await client.storageState()), { mode: 0o600 });
  } finally {
    await client.dispose();
  }
}

export default async function globalSetup() {
  const base = process.env.FEITO_E2E_URL ?? "https://127.0.0.1:3100";
  const secret = () => randomBytes(18).toString("base64url");
  const fresh = { email: `novo-${randomUUID()}@feito.test`, password: secret() };
  create(fresh.email, fresh.password);
  rmSync(AUTH_DIR, { recursive: true, force: true });
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  const active: Record<string, { email: string; password: string }> = {};
  for (const name of ["desktop", "celular"]) {
    const email = `${name}-${randomUUID()}@feito.test`;
    const provisional = secret();
    create(email, provisional);
    const password = secret();
    await activate(base, name, email, provisional, password);
    active[name] = { email, password };
  }
  writeFileSync(ACCOUNTS_FILE, JSON.stringify({ fresh, active }), { mode: 0o600 });
}

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../../scripts/new-env.sh", import.meta.url));
const origin = "https://feito.example.org";
const projectRef = "abcdefghijklmnopqrst";
const poolerHost = "aws-0-sa-east-1.pooler.supabase.com";
const tls = "sslmode=verify-full&sslrootcert=/run/config/feito-postgres-ca.crt";
const databaseAccounts = [
  ["DOMAIN_DATABASE_URL", "feito_app", "POSTGRES_APP_PASSWORD"],
  ["AUTH_DATABASE_URL", "feito_auth", "POSTGRES_AUTH_PASSWORD"],
  ["MIGRATION_DATABASE_URL", "feito_migrator", "POSTGRES_MIGRATOR_PASSWORD"],
  ["IDENTITY_ADMIN_DATABASE_URL", "feito_identity_admin", "POSTGRES_IDENTITY_ADMIN_PASSWORD"],
] as const;

describe("new-env.sh", () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "feito-new-env-"));
    file = join(directory, "feito.env");
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function expectDatabaseUrls(endpoint: string, suffix = "") {
    const env = parseEnv(readFileSync(file, "utf8"));

    expect(env.FEITO_ORIGIN).toBe(origin);
    for (const [urlKey, role, passwordKey] of databaseAccounts) {
      expect(env[passwordKey]).toMatch(/^[0-9a-f]{64}$/);
      expect(env[urlKey]).toBe(`postgresql://${role}${suffix}:${env[passwordKey]}@${endpoint}`);
    }
    expect(new Set(databaseAccounts.map(([, , passwordKey]) => env[passwordKey])).size).toBe(4);
  }

  it("accepts a positional origin for existing local setups", () => {
    execFileSync("sh", [script, file, origin]);
    expectDatabaseUrls("127.0.0.1:5432/feito");
  });

  it("generates the four direct URLs from a project reference", () => {
    execFileSync("sh", [script, file, "--supabase-direct", "--project-ref", projectRef, "--origin", origin]);
    expectDatabaseUrls(`db.${projectRef}.supabase.co:5432/postgres?${tls}`);
  });

  it.each([
    { flags: [], input: `${projectRef}\n${poolerHost}\n`, projectPrompt: true, poolerPrompt: true },
    { flags: ["--project-ref", projectRef], input: `${poolerHost}\n`, projectPrompt: false, poolerPrompt: true },
    { flags: ["--pooler-host", poolerHost], input: `${projectRef}\n`, projectPrompt: true, poolerPrompt: false },
    { flags: ["--pooler-host", poolerHost, "--project-ref", projectRef], input: "", projectPrompt: false, poolerPrompt: false },
  ])("generates Session pooler URLs with flags $flags", ({ flags, input, projectPrompt, poolerPrompt }) => {
    const result = spawnSync("sh", [script, file, ...flags, "--origin", origin, "--supabase"], { input, encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stderr.includes("Referência do projeto Supabase")).toBe(projectPrompt);
    expect(result.stderr.includes("Host do Session pooler")).toBe(poolerPrompt);
    expectDatabaseUrls(`${poolerHost}:5432/postgres?${tls}`, `.${projectRef}`);
  });

  it("rejects an invalid project reference", () => {
    const result = spawnSync("sh", [script, file, "--supabase", "--project-ref", "https://db.example.org"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("referência do projeto Supabase");
    expect(existsSync(file)).toBe(false);
  });

  it.each(["pooler", "db.example.supabase.co", `${poolerHost}:6543`])("rejects invalid pooler input %j", (host) => {
    const result = spawnSync("sh", [script, file, "--supabase", "--project-ref", projectRef, "--pooler-host", host], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(existsSync(file)).toBe(false);
  });

  it("fails without writing a file when input ends before the pooler host", () => {
    const result = spawnSync("sh", [script, file, "--supabase"], { input: `${projectRef}\n`, encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Informe o host com --pooler-host");
    expect(existsSync(file)).toBe(false);
  });

  it("preserves an existing credentials file when a project reference is supplied", () => {
    execFileSync("sh", [script, file, origin]);
    const original = readFileSync(file, "utf8");

    const result = spawnSync("sh", [script, file, "--supabase"], { input: "", encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("já existe");
    expect(readFileSync(file, "utf8")).toBe(original);
  });
});

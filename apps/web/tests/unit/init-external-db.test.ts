import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../../scripts/init-external-db.sh", import.meta.url));
const generator = fileURLToPath(new URL("../../../../scripts/new-env.sh", import.meta.url));
const sqlFile = fileURLToPath(new URL("../../../../scripts/postgres-init.sql", import.meta.url));
const projectRef = "abcdefghijklmnopqrst";
const poolerHost = "aws-0-sa-east-1.pooler.supabase.com";

describe("init-external-db.sh", () => {
  let directory: string;
  let file: string;
  let certificate: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "feito-init-external-db-"));
    file = join(directory, "credentials with spaces.env");
    certificate = join(directory, "postgres ca.crt");
    writeFileSync(certificate, "test certificate");
    writeFileSync(join(directory, "docker"), `#!/bin/sh
printf '%s\n' "$@" "$PGSSLMODE" "$POSTGRES_MIGRATOR_PASSWORD" "$POSTGRES_APP_PASSWORD" \\
  "$POSTGRES_AUTH_PASSWORD" "$POSTGRES_IDENTITY_ADMIN_PASSWORD"
`, { mode: 0o700 });
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function run(...args: string[]) {
    return spawnSync(script, ["credentials with spaces.env", ...args], {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`, FEITO_POSTGRES_CA_FILE: certificate },
      encoding: "utf8",
    });
  }

  it.each([
    {
      flags: ["--supabase", "--project-ref", projectRef, "--pooler-host", poolerHost],
      host: poolerHost,
      adminUser: `postgres.${projectRef}`,
    },
    {
      flags: ["--supabase-direct", "--project-ref", projectRef],
      host: `db.${projectRef}.supabase.co`,
      adminUser: "postgres",
    },
  ])("initializes $host using the generated credentials file", ({ flags, host, adminUser }) => {
    execFileSync(generator, [file, ...flags]);
    const env = parseEnv(readFileSync(file, "utf8"));
    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual([
      "run", "--rm", "-it",
      "-e", "POSTGRES_MIGRATOR_PASSWORD", "-e", "POSTGRES_APP_PASSWORD",
      "-e", "POSTGRES_AUTH_PASSWORD", "-e", "POSTGRES_IDENTITY_ADMIN_PASSWORD", "-e", "PGSSLMODE",
      "--volume", `${sqlFile}:/postgres-init.sql:ro`,
      "--mount", `type=bind,source=${certificate},target=/run/config/feito-postgres-ca.crt,readonly`,
      "postgres:18", "psql", "-X", "-W",
      "--single-transaction", "--set=feito_external=1", `--username=${adminUser}`,
      `--dbname=postgresql://${host}:5432/postgres?sslmode=verify-full&sslrootcert=/run/config/feito-postgres-ca.crt`,
      "--file=/postgres-init.sql",
      "require", env.POSTGRES_MIGRATOR_PASSWORD, env.POSTGRES_APP_PASSWORD,
      env.POSTGRES_AUTH_PASSWORD, env.POSTGRES_IDENTITY_ADMIN_PASSWORD,
    ]);
  });

  it("fails before starting Docker if the configured CA file is missing", () => {
    execFileSync(generator, [file, "--supabase-direct", "--project-ref", projectRef]);
    rmSync(certificate);

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FEITO_POSTGRES_CA_FILE");
    expect(result.stdout).toBe("");
  });

  it("supports a custom administrative user and preserves the destination and connection options", () => {
    execFileSync(generator, [file]);
    const credentials = readFileSync(file, "utf8");
    writeFileSync(file, credentials.replace(/^MIGRATION_DATABASE_URL=.*$/m,
      "MIGRATION_DATABASE_URL='postgres://feito_migrator:private%40value@db.internal:6432/other?sslmode=verify-full&connect_timeout=5'"));

    const result = run("--admin-user", "database_admin");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--username=database_admin\n");
    expect(result.stdout).toContain("--dbname=postgresql://db.internal:6432/other?sslmode=verify-full&connect_timeout=5\n");
    expect(result.stdout).not.toContain("--mount\n");
    expect(result.stdout).not.toContain("private%40value");
  });

  it("asks for an external host when the file contains the local defaults", () => {
    execFileSync(generator, [file]);
    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Configure MIGRATION_DATABASE_URL com o host externo");
    expect(result.stdout).toBe("");
  });
});

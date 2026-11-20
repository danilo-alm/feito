import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const composeFile = fileURLToPath(new URL("../../compose.prod.tunnel.yaml", import.meta.url));
const origin = "https://feito.example.org";
const caTarget = "/run/config/feito-postgres-ca.crt";
const tls = `sslmode=verify-full&sslrootcert=${caTarget}`;
const database = `db.abcdefghijklmnopqrst.supabase.co:5432/postgres?${tls}`;

type Volume = { type: string; source: string; target: string; read_only?: boolean; bind?: { create_host_path?: boolean } };
type Service = {
  image: string;
  platform?: string;
  ports?: unknown[];
  networks?: Record<string, unknown>;
  network_mode?: string;
  environment: Record<string, string>;
  volumes?: Volume[];
  depends_on?: Record<string, { condition: string }>;
};

describe("compose.prod.tunnel.yaml", () => {
  let directory: string;
  let certificate: string;
  let envFile: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "feito-compose-"));
    certificate = join(directory, "prod-ca.crt");
    envFile = join(directory, "prod.env");
    writeFileSync(certificate, "certificado de teste\n");
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function writeEnv(overrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
      FEITO_ORIGIN: origin,
      BETTER_AUTH_SECRET: "a".repeat(64),
      IMPORT_PREVIEW_SECRET: "b".repeat(64),
      DATA_KEK_ACTIVE_VERSION: "1",
      DATA_KEK_V1: "c".repeat(44),
      CLOUDFLARE_TUNNEL_TOKEN: "token-de-teste",
      FEITO_POSTGRES_CA_FILE: certificate,
      DOMAIN_DATABASE_URL: `postgresql://feito_app:x@${database}`,
      AUTH_DATABASE_URL: `postgresql://feito_auth:x@${database}`,
      MIGRATION_DATABASE_URL: `postgresql://feito_migrator:x@${database}`,
      IDENTITY_ADMIN_DATABASE_URL: `postgresql://feito_identity_admin:x@${database}`,
      ...overrides,
    };
    const lines = Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}='${value}'`);
    writeFileSync(envFile, `${lines.join("\n")}\n`);
  }

  function config() {
    // Sem herdar variáveis do shell, o resultado depende só do arquivo de ambiente.
    return spawnSync(
      "docker",
      ["compose", "-f", composeFile, "--env-file", envFile, "--profile", "tools", "config", "--format", "json"],
      { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? directory } },
    );
  }

  function services() {
    const result = config();
    expect(result.stderr).not.toMatch(/error/i);
    expect(result.status).toBe(0);
    return (JSON.parse(result.stdout) as { services: Record<string, Service> }).services;
  }

  it("coloca o cloudflared na mesma rede do app e não publica portas no host", () => {
    writeEnv();
    const { app, cloudflared, migrate, cli } = services();

    // O 502 vinha de uma Service URL em 127.0.0.1, que dentro de um contêiner aponta para ele mesmo.
    for (const service of [app, cloudflared, migrate, cli]) {
      expect(service.ports ?? []).toEqual([]);
      expect(service.network_mode).toBeUndefined();
    }
    expect(Object.keys(cloudflared.networks ?? {})).toEqual(Object.keys(app.networks ?? {}));
    expect(cloudflared.depends_on).toEqual({ app: expect.objectContaining({ condition: "service_healthy" }) });
    expect(cloudflared.environment.TUNNEL_TOKEN).toBe("token-de-teste");
    expect(cloudflared.image).toMatch(/^cloudflare\/cloudflared:\d{4}\.\d+\.\d+$/);
  });

  it("mantém o domínio público e confia apenas no IP informado pela Cloudflare", () => {
    writeEnv();
    const { app } = services();

    expect(app.environment.FEITO_ORIGIN).toBe(origin);
    expect(app.environment.AUTH_CLIENT_IP_HEADER).toBe("cf-connecting-ip");
    expect(app.image).toBe("ghcr.io/danilo-alm/feito:latest");
    expect(app.platform).toBe("linux/amd64");
  });

  it("monta a CA do banco e preserva a validação TLS nas URLs", () => {
    writeEnv();
    const { app, migrate, cli } = services();

    for (const service of [app, migrate, cli]) {
      expect(service.volumes).toContainEqual(
        expect.objectContaining({
          type: "bind",
          source: certificate,
          target: caTarget,
          read_only: true,
          bind: expect.objectContaining({ create_host_path: false }),
        }),
      );
    }
    expect(migrate.image).toBe("ghcr.io/danilo-alm/feito-tools:latest");
    expect(cli.image).toBe(migrate.image);
    expect(migrate.environment.MIGRATION_DATABASE_URL).toContain(tls);
    expect(app.environment.DOMAIN_DATABASE_URL).toContain(tls);
    expect(app.environment.AUTH_DATABASE_URL).toContain(tls);
    expect(cli.environment.IDENTITY_ADMIN_DATABASE_URL).toContain(tls);
  });

  it.each(["CLOUDFLARE_TUNNEL_TOKEN", "FEITO_POSTGRES_CA_FILE", "FEITO_ORIGIN", "DOMAIN_DATABASE_URL"])(
    "recusa subir sem %s",
    (name) => {
      writeEnv({ [name]: undefined });
      const result = config();

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(name);
    },
  );
});

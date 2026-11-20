import { fileURLToPath } from "node:url";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { ConfigurationError, databaseUrl } from "../src/server/crypto/config";

const connectionTimeoutMillis = 10_000;
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function reportFailure(stage: string, error: unknown) {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  let detail = "erro sem código";
  if (cause instanceof ConfigurationError) {
    detail = cause.message;
  } else if (cause instanceof Error && cause.message === "timeout expired") {
    detail = `tempo limite de ${connectionTimeoutMillis / 1000} s`;
  } else if (cause instanceof Error && "code" in cause && typeof cause.code === "string" && /^[A-Z0-9_]{3,48}$/.test(cause.code)) {
    detail = cause.code;
  }
  console.error(`Falha ao ${stage} (${detail}).`);
  process.exitCode = 1;
}

async function main() {
  let stage = "conectar ao PostgreSQL";
  const client = new Client({
    connectionString: databaseUrl("MIGRATION_DATABASE_URL"),
    connectionTimeoutMillis,
  });
  client.on("error", (error) => reportFailure(stage, error));

  try {
    console.log("Conectando ao PostgreSQL...");
    await client.connect();
    stage = "aplicar as migrações";
    console.log("Aplicando migrações...");
    await migrate(drizzle(client), { migrationsFolder });
    console.log("Migrações aplicadas com sucesso.");
  } catch (error) {
    reportFailure(stage, error);
  } finally {
    await client.end();
  }
}

main().catch((error) => reportFailure("executar a migração", error));

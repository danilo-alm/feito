import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const name = "MIGRATION_DATABASE_URL";
const directory = process.env.APP_SECRETS_DIR;
if (directory && process.env[name]) throw new Error(`Configuração duplicada (${name}).`);
const url = directory
  ? readFileSync(join(directory, name), "utf8").trimEnd()
  : process.env[name];

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["identity", "domain", "crypto_ops"],
  dbCredentials: { url: url ?? "" },
  strict: true,
});

import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const common = new URL("../../../../packages/core/sqlite/", import.meta.url);
const sqlite = dirname(import.meta.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"));
export const vendorNames = ["index.mjs", "sqlite3-opfs-async-proxy.js", "sqlite3.wasm"];

export async function sqliteProofAssets({ benchmark = false } = {}) {
  const queryDirectory = new URL("queries/", common);
  const queries = await Promise.all((await readdir(queryDirectory)).map(async (file) =>
    [file, await readFile(new URL(file, queryDirectory), "utf8")],
  ));
  const migrationsDirectory = new URL("migrations/", common);
  const migrations = await Promise.all((await readdir(migrationsDirectory)).sort()
    .map((file) => readFile(new URL(file, migrationsDirectory), "utf8")));
  const testSql = new URL("../../../../scripts/sqlite-proof/", import.meta.url);
  const schema = await readFile(new URL("schema.sql", testSql), "utf8");
  const fixture = await readFile(new URL("relational-fixture.sql", testSql), "utf8");
  const modules = await build({
    entryPoints: {
      storage: fileURLToPath(new URL("../../src/browser/sqlite/storage.ts", import.meta.url)),
      legacy: fileURLToPath(new URL("../../src/browser/sqlite/legacy.ts", import.meta.url)),
      ...(benchmark ? { benchmark: fileURLToPath(new URL("./indexeddb-benchmark.ts", import.meta.url)) } : {}),
    },
    bundle: true,
    minify: true,
    format: "esm",
    outdir: "sqlite-proof",
    outExtension: { ".js": ".mjs" },
    write: false,
  });
  const assets = await Promise.all([
    ...["worker.mjs", "client.mjs"].map(async (name) =>
      [name, await readFile(new URL(name, import.meta.url))],
    ),
    ...vendorNames.map(async (name) => [name, await readFile(new URL(sqlite + "/" + name))]),
  ]);
  assets.push(...modules.outputFiles.map((file) => [basename(file.path), file.contents]));
  assets.push(["sql.mjs", Buffer.from(
    `export const migrations = ${JSON.stringify(migrations)};\n` +
    `export const queries = ${JSON.stringify(Object.fromEntries(queries))};\n` +
    `export const proofSchema = ${JSON.stringify(schema)};\nexport const fixture = ${JSON.stringify(fixture)};\n`,
  )]);
  return assets;
}

export async function stageSqliteProof(destination) {
  await mkdir(destination, { recursive: true });
  await Promise.all((await sqliteProofAssets()).map(([name, bytes]) => writeFile(join(destination, name), bytes)));
}

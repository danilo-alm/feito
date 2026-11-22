import { build } from "esbuild";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../../../packages/core/sqlite/", import.meta.url);

async function sqlFiles(directory) {
  const base = new URL(directory + "/", root);
  return Promise.all((await readdir(base)).sort().map(async (file) => [
    file, await readFile(new URL(file, base), "utf8"),
  ]));
}

export async function stageSqlite(destination) {
  const vendor = dirname(fileURLToPath(import.meta.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")));
  const [migrations, queries] = await Promise.all([sqlFiles("migrations"), sqlFiles("queries")]);
  await mkdir(destination, { recursive: true });
  await Promise.all(["index.mjs", "sqlite3-opfs-async-proxy.js", "sqlite3.wasm"].map((file) =>
    copyFile(join(vendor, file), join(destination, file))));
  await build({
    entryPoints: [fileURLToPath(new URL("../src/browser/sqlite/worker.ts", import.meta.url))],
    outfile: join(destination, "worker.mjs"),
    bundle: true,
    minify: true,
    format: "esm",
    define: {
      sqliteMigrations: JSON.stringify(migrations.map(([, sql]) => sql)),
      sqliteQueries: JSON.stringify(Object.fromEntries(queries)),
    },
    plugins: [{
      name: "sqlite-vendor",
      setup(plugin) {
        plugin.onResolve({ filter: /^@sqlite\.org\/sqlite-wasm$/ }, () => ({ path: "./index.mjs", external: true }));
      },
    }],
  });
}

if (process.argv[2] === "--dev") {
  await stageSqlite(fileURLToPath(new URL("../public/sqlite-dev/", import.meta.url)));
}

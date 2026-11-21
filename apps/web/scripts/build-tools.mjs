import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const web = fileURLToPath(new URL("../", import.meta.url));
const root = join(web, "../..");
const output = join(web, "dist-tools");

// Empacota migrate, admin e keys em ESM autocontido para a imagem `tools`.
// A condição react-server resolve `server-only` para o módulo vazio, como em
// `node --conditions=react-server`. Só o argon2 nativo (.node) fica fora do
// bundle e é copiado para a imagem junto com o resultado.
await rm(output, { recursive: true, force: true });
await build({
  absWorkingDir: web,
  entryPoints: ["scripts/migrate.ts", "scripts/admin.ts", "scripts/keys.ts"],
  outdir: join(output, "dist"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node24",
  conditions: ["react-server"],
  external: ["@node-rs/argon2", "pg-native"],
  legalComments: "none",
  logLevel: "warning",
  // Dependências CommonJS empacotadas em ESM precisam de `require`.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});

// O migrator lê `../drizzle` a partir de `dist/`.
await cp(join(web, "drizzle"), join(output, "drizzle"), { recursive: true });
await mkdir(output, { recursive: true });

const { packageManager } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await writeFile(
  join(output, "package.json"),
  `${JSON.stringify(
    {
      name: "feito-tools",
      private: true,
      type: "module",
      packageManager,
      scripts: {
        "db:migrate": "node dist/migrate.mjs",
        admin: "node dist/admin.mjs",
        keys: "node dist/keys.mjs",
      },
    },
    null,
    2,
  )}\n`,
);

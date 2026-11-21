import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../", import.meta.url));
const output = join(web, ".next");
const staticDir = join(output, "static");
const pages = join(output, "server", "app");
const build = (await readFile(join(output, "BUILD_ID"), "utf8")).trim();
const shell = `/_next/static/${build}/feito-shell.html`;
const publicDir = join(web, "public");

// O mesmo build fornece o HTML genérico e seus recursos imutáveis. Um deploy
// que troque de versão durante o download não pode misturar os dois conjuntos.
await copyFile(join(pages, "navegador.html"), join(staticDir, build, "feito-shell.html"));

const staticFiles = await readdir(staticDir, { recursive: true, withFileTypes: true });
const assets = staticFiles
  .filter((file) => file.isFile() && !file.name.endsWith(".map"))
  .map((file) => join(file.parentPath, file.name))
  .sort()
  .map((file) => [`/_next/static/${file.slice(staticDir.length + 1)}`, file]);
for (const path of ["/manifest.webmanifest", "/icon.svg", "/apple-icon", "/pwa/icon-192.png", "/pwa/icon-512.png", "/pwa/maskable-512.png"]) {
  assets.push([path, join(pages, `${path.slice(1)}.body`)]);
}

const entries = await Promise.all(assets.map(async ([url, file]) => ({
  url,
  integrity: `sha256-${createHash("sha256").update(await readFile(file)).digest("base64")}`,
})));
const worker = await readFile(join(web, "src", "offline", "service-worker.js"), "utf8");
await mkdir(publicDir, { recursive: true });
await writeFile(join(publicDir, "service-worker.js"), `const packageFiles = ${JSON.stringify({ build, shell, entries })};\n${worker}`);

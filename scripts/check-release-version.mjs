import { readFileSync } from "node:fs";

const configPath = "apps/desktop/src-tauri/tauri.conf.json";
function readJson(path) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
}

const { version, bundle } = readJson(configPath);
const tag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
const releaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta)?$/;

if (typeof version !== "string" || !releaseVersion.test(version) || tag !== `v${version}`) {
  console.error(`A tag deve ser vX.Y.Z ou vX.Y.Z-beta e coincidir com a versão em ${configPath}.`);
  process.exit(1);
}

for (const path of ["apps/web/package.json", "apps/desktop/package.json"]) {
  if (readJson(path).version !== version) {
    console.error(`A versão em ${path} deve ser ${version}.`);
    process.exitCode = 1;
  }
}

const wixVersion = bundle?.windows?.wix?.version;
const numericVersion = version.replace(/-beta$/, "");
if ((version.endsWith("-beta") || wixVersion !== undefined) && wixVersion !== numericVersion) {
  console.error(`A versão do instalador MSI em ${configPath} deve ser ${numericVersion}.`);
  process.exitCode = 1;
}

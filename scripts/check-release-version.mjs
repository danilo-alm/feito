import { readFileSync } from "node:fs";

const configPath = "apps/desktop/src-tauri/tauri.conf.json";
const { version } = JSON.parse(readFileSync(new URL(`../${configPath}`, import.meta.url), "utf8"));
const tag = process.env.GITHUB_REF_NAME;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (typeof version !== "string" || !stableVersion.test(version) || tag !== `v${version}`) {
  console.error(`A tag de release deve ser vX.Y.Z e coincidir com a versão em ${configPath}.`);
  process.exitCode = 1;
}

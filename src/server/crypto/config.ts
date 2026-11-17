import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

type Environment = Record<string, string | undefined>;

export class ConfigurationError extends Error {
  constructor(name: string) {
    super(`Configuração ausente, inválida ou duplicada (${name}).`);
  }
}

export function secret(name: string, env: Environment = process.env): string {
  let value = env[name];
  if (env.APP_SECRETS_DIR) {
    if (value) throw new ConfigurationError(name);
    try {
      value = readFileSync(join(env.APP_SECRETS_DIR, name), "utf8").replace(/\r?\n$/, "");
    } catch {
      throw new ConfigurationError(name);
    }
  }
  if (!value) throw new ConfigurationError(name);
  return value;
}

export function databaseUrl(name: string, env: Environment = process.env) {
  const value = secret(name, env);
  const url = z.url({ protocol: /^postgres(?:ql)?$/ }).safeParse(value);
  if (!url.success) throw new ConfigurationError(name);
  return value;
}

export function readAuthConfig(env: Environment = process.env) {
  const secretValue = secret("BETTER_AUTH_SECRET", env);
  if (secretValue.length < 32) throw new ConfigurationError("BETTER_AUTH_SECRET");
  const origin = z.url({ protocol: /^https$/ }).safeParse(env.FEITO_ORIGIN);
  if (!origin.success || new URL(origin.data).origin !== origin.data) {
    throw new ConfigurationError("FEITO_ORIGIN");
  }
  const clientIpHeader = env.AUTH_CLIENT_IP_HEADER?.toLowerCase() || undefined;
  if (clientIpHeader && !/^[a-z0-9-]+$/.test(clientIpHeader)) {
    throw new ConfigurationError("AUTH_CLIENT_IP_HEADER");
  }
  return { secret: secretValue, origin: origin.data, clientIpHeader };
}

const keyName = /^DATA_KEK_V([1-9]\d*)$/;

export function readKeyConfig(env: Environment = process.env) {
  const installationId = z.uuid().safeParse(env.FEITO_INSTALLATION_ID);
  if (!installationId.success) throw new ConfigurationError("FEITO_INSTALLATION_ID");
  const activeVersion = Number(env.DATA_KEK_ACTIVE_VERSION);
  if (!/^[1-9]\d*$/.test(env.DATA_KEK_ACTIVE_VERSION ?? "") || activeVersion > 2147483647) {
    throw new ConfigurationError("DATA_KEK_ACTIVE_VERSION");
  }

  const environmentKeys = Object.keys(env).filter((name) => keyName.test(name) && env[name]);
  let names = environmentKeys;
  if (env.APP_SECRETS_DIR) {
    if (environmentKeys.length) throw new ConfigurationError("DATA_KEK_V*");
    try {
      names = readdirSync(env.APP_SECRETS_DIR).filter((name) => keyName.test(name));
    } catch {
      throw new ConfigurationError("APP_SECRETS_DIR");
    }
  }

  const keys = new Map<number, Buffer>();
  const seen = new Set<string>();
  for (const name of names) {
    const version = Number(keyName.exec(name)![1]);
    const value = secret(name, env);
    const key = Buffer.from(value, "base64");
    if (version > 2147483647 || key.length !== 32 || key.toString("base64") !== value || seen.has(value)) {
      key.fill(0);
      throw new ConfigurationError(name);
    }
    seen.add(value);
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) throw new ConfigurationError(`DATA_KEK_V${activeVersion}`);
  return { installationId: installationId.data, activeVersion, keys };
}

export type AuthConfig = ReturnType<typeof readAuthConfig>;
export type KeyConfig = ReturnType<typeof readKeyConfig>;

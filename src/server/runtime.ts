import "server-only";
import { ConfigurationError, readAuthConfig, readKeyConfig, readPortabilityConfig } from "@/server/crypto/config";
import { connectDatabase } from "@/server/db/client";

function startRuntime() {
  const config = readAuthConfig();
  const keys = readKeyConfig();
  const portability = readPortabilityConfig();
  if (portability.previewSecret === config.secret
    || [...keys.keys.values()].some((key) => key.toString("base64") === portability.previewSecret)) {
    throw new ConfigurationError("IMPORT_PREVIEW_SECRET");
  }
  const identity = connectDatabase("AUTH_DATABASE_URL", 8);
  const domain = connectDatabase("DOMAIN_DATABASE_URL", 8);
  return {
    identity: { db: identity.db, config },
    db: domain.db,
    keys,
    portability,
    close: () => Promise.all([identity.close(), domain.close()]),
  };
}

// One pair of pools per Node process, including across dev module reloads.
const processState = globalThis as typeof globalThis & { feitoRuntime?: ReturnType<typeof startRuntime> };
export function getRuntime() {
  return processState.feitoRuntime ??= startRuntime();
}

import "server-only";
import { referenceDate } from "@feito/core/domain/preferences";
import type { KeyConfig } from "@/server/crypto/config";
import type { Database } from "@/server/db/client";
import { ensureWorkspace, persistPreferences, readWorkspace } from "@/server/db/workspace";
import type { Preferences } from "@feito/core/validation/preferences";
import { publicIdentity, type IdentitySession } from "./identity";

export async function getMe(db: Database, keys: KeyConfig, identity: IdentitySession) {
  await ensureWorkspace(db, keys, identity.tenantId);
  const workspace = await readWorkspace(db, keys, identity.tenantId);
  return {
    ...publicIdentity(identity),
    ...workspace,
    referenceDate: referenceDate(workspace.preferences.timezone),
  };
}

export async function updatePreferences(
  db: Database, keys: KeyConfig, tenantId: string, patch: Partial<Preferences>,
) {
  await ensureWorkspace(db, keys, tenantId);
  return persistPreferences(db, keys, tenantId, patch);
}

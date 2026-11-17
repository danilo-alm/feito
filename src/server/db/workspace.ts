import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { defaultPreferences } from "@/domain/preferences";
import type { KeyConfig } from "@/server/crypto/config";
import { sealPayload, wrapDek } from "@/server/crypto/envelope";
import type { PayloadContext } from "@/server/crypto/envelope";
import { preferences as preferencesSchema, type Preferences } from "@/validation/account";
import type { Database, Transaction } from "./client";
import { decodeProduct, reserveKek, useDek, withDekWrite } from "./product-crypto";
import { dekUsage, preferences, projects, tenantKeys, tenants } from "./schema";
import { lockTenant, withTenant } from "./tenant";

function preferenceContext(row: Pick<typeof preferences.$inferSelect,
  "tenantId" | "dekVersion" | "payloadVersion" | "revision">): PayloadContext {
  return { ...row, type: "preferences", id: row.tenantId, links: [] };
}

export async function ensureWorkspace(db: Database, keys: KeyConfig, tenantId: string) {
  const exists = await withTenant(db, tenantId, async (tx) => {
    const [tenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    return !!tenant;
  });
  if (exists) return;

  const kekVersion = keys.activeVersion;
  await reserveKek(db, kekVersion);

  await withTenant(db, tenantId, async (tx) => {
    const version = 1;
    const [created] = await tx.insert(tenants).values({ id: tenantId, activeDekVersion: version })
      .onConflictDoNothing().returning({ id: tenants.id });
    if (!created) return;
    await lockTenant(tx, tenantId);

    const dek = randomBytes(32);
    try {
      const envelope = { tenantId, version, kekVersion };
      await tx.insert(tenantKeys).values({ ...envelope, ...wrapDek(keys, envelope, dek) });
      // A new, unpublished DEK is discarded on rollback and is never used again.
      await tx.insert(dekUsage).values({ tenantId, dekVersion: version, invocations: 2 });

      const metadata = { tenantId, dekVersion: version, payloadVersion: 1, revision: 1 };
      await tx.insert(preferences).values({
        ...metadata,
        ...sealPayload(keys.installationId, dek, preferenceContext(metadata), defaultPreferences),
      });
      const inbox = { ...metadata, id: randomUUID(), isInbox: true };
      await tx.insert(projects).values({
        ...inbox,
        ...sealPayload(keys.installationId, dek, {
          ...metadata, type: "project", id: inbox.id, links: [inbox.isInbox],
        }, {
          name: "Caixa de entrada",
          archived: false,
          view: { layout: "list", sortMode: "manual", showCompleted: false },
        }),
      });
    } finally {
      dek.fill(0);
    }
  });
}

async function preferenceRow(tx: Transaction, tenantId: string) {
  const [row] = await tx.select().from(preferences).where(eq(preferences.tenantId, tenantId));
  if (!row) throw new Error("Preferências indisponíveis.");
  return row;
}

async function readPreferences(tx: Transaction, keys: KeyConfig, row: typeof preferences.$inferSelect) {
  return useDek(tx, keys, row.tenantId, row.dekVersion, async (dek) =>
    decodeProduct(keys, dek, preferenceContext(row), row, preferencesSchema));
}

export function readWorkspace(db: Database, keys: KeyConfig, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [inbox] = await tx.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.isInbox, true)));
    if (!inbox) throw new Error("Caixa de entrada indisponível.");
    return {
      inboxProjectId: inbox.id,
      preferences: await readPreferences(tx, keys, await preferenceRow(tx, tenantId)),
    };
  });
}

export async function persistPreferences(
  db: Database, keys: KeyConfig, tenantId: string, patch: Partial<Preferences>,
) {
  if (!Object.keys(patch).length) return (await readWorkspace(db, keys, tenantId)).preferences;

  return withDekWrite(db, keys, tenantId, 1, async (tx, version, dek) => {
    const row = await preferenceRow(tx, tenantId);
    const current = row.dekVersion === version
      ? decodeProduct(keys, dek, preferenceContext(row), row, preferencesSchema)
      : await readPreferences(tx, keys, row);
    const updated = { ...current, ...patch };
    const metadata = { dekVersion: version, payloadVersion: 1, revision: row.revision + 1 };
    await tx.update(preferences).set({
      ...metadata,
      ...sealPayload(keys.installationId, dek, preferenceContext({ tenantId, ...metadata }), updated),
    }).where(eq(preferences.tenantId, tenantId));
    return updated;
  });
}

import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { wrapDek } from "@/server/crypto/envelope";
import type { Transaction } from "./client";
import {
  productEncoder, readLabelRecord, readOccurrenceRecord, readPreferenceRecord, readProjectRecord,
  readSectionRecord, readTaskRecord, type ProductAccess,
} from "./product";
import { reserveKek, useDek, withDekWrite, withProductReader, type ProductReader } from "./product-crypto";
import { completedOccurrences, dekUsage, labels, preferences, projects, sections, tasks, tenantKeys, tenants } from "./schema";
import { advanceProductRevision, lockTenant, withTenant } from "./tenant";
import { writePreferences } from "./workspace";

export async function activateDek({ db, keys, tenantId }: ProductAccess) {
  await reserveKek(db, keys.activeVersion);
  return withTenant(db, tenantId, async (tx) => {
    const tenant = await lockTenant(tx, tenantId);
    const version = tenant.activeDekVersion + 1;
    if (version > 2147483647) throw new Error("Limite de versões de DEK atingido.");
    const dek = randomBytes(32);
    try {
      const envelope = { tenantId, version, kekVersion: keys.activeVersion };
      await tx.insert(tenantKeys).values({ ...envelope, ...wrapDek(keys, envelope, dek) });
      await tx.insert(dekUsage).values({ tenantId, dekVersion: version, invocations: 0 });
      await tx.update(tenants).set({ activeDekVersion: version }).where(eq(tenants.id, tenantId));
      await advanceProductRevision(tx, tenant);
      return version;
    } finally {
      dek.fill(0);
    }
  });
}

export async function rewrapKek({ db, keys, tenantId }: ProductAccess) {
  const older = ne(tenantKeys.kekVersion, keys.activeVersion);
  let rewritten = 0;
  for (;;) {
    const candidates = await withTenant(db, tenantId, (tx) => tx.select({ version: tenantKeys.version })
      .from(tenantKeys).where(older).orderBy(asc(tenantKeys.version)).limit(25));
    if (!candidates.length) {
      const exists = await withTenant(db, tenantId, (tx) => tx.select({ id: tenants.id }).from(tenants));
      if (!exists.length) throw new Error("Tenant indisponível.");
      return rewritten;
    }

    for (const _candidate of candidates) await reserveKek(db, keys.activeVersion);
    rewritten += await withTenant(db, tenantId, async (tx) => {
      const tenant = await lockTenant(tx, tenantId);
      const rows = await tx.select({ version: tenantKeys.version }).from(tenantKeys)
        .where(and(older, inArray(tenantKeys.version, candidates.map(({ version }) => version))));
      for (const { version } of rows) {
        await useDek(tx, keys, tenantId, version, async (dek) => {
          const envelope = { tenantId, version, kekVersion: keys.activeVersion };
          await tx.update(tenantKeys).set({
            kekVersion: keys.activeVersion, aadVersion: 2, ...wrapDek(keys, envelope, dek.key),
          }).where(eq(tenantKeys.version, version));
        });
      }
      if (rows.length) await advanceProductRevision(tx, tenant);
      return rows.length;
    });
  }
}

const rekeyBatchSize = 100;

async function loadOlderRecords(tx: Transaction, version: number) {
  return {
    preferences: await tx.select().from(preferences).where(ne(preferences.dekVersion, version)).limit(1),
    projects: await tx.select().from(projects).where(ne(projects.dekVersion, version)).limit(rekeyBatchSize),
    sections: await tx.select().from(sections).where(ne(sections.dekVersion, version)).limit(rekeyBatchSize),
    labels: await tx.select().from(labels).where(ne(labels.dekVersion, version)).limit(rekeyBatchSize),
    tasks: await tx.select().from(tasks).where(ne(tasks.dekVersion, version)).limit(rekeyBatchSize),
    occurrences: await tx.select().from(completedOccurrences).where(ne(completedOccurrences.dekVersion, version)).limit(rekeyBatchSize),
  };
}

type Batch = Awaited<ReturnType<typeof loadOlderRecords>>;
const countRecords = (records: Batch) => Object.values(records).reduce((count, rows) => count + rows.length, 0);

async function rewriteRecords(tx: Transaction, tenantId: string, version: number, key: Buffer, reader: ProductReader, batch: Batch) {
  const encode = productEncoder(tenantId, version, key);
  for (const row of batch.preferences) {
    const value = await readPreferenceRecord(reader, row);
    await writePreferences(tx, tenantId, version, key, row.revision, value);
  }
  for (const row of batch.projects) {
    await tx.update(projects).set(encode.project(await readProjectRecord(reader, row))).where(eq(projects.id, row.id));
  }
  for (const row of batch.sections) {
    await tx.update(sections).set(encode.section(await readSectionRecord(reader, row))).where(eq(sections.id, row.id));
  }
  for (const row of batch.labels) {
    await tx.update(labels).set(encode.label(await readLabelRecord(reader, row))).where(eq(labels.id, row.id));
  }
  for (const row of batch.tasks) {
    await tx.update(tasks).set(encode.task(await readTaskRecord(reader, row))).where(eq(tasks.id, row.id));
  }
  for (const row of batch.occurrences) {
    const { occurrenceId, taskId, revision: _revision, ...encrypted } = encode.occurrence(await readOccurrenceRecord(reader, row));
    await tx.update(completedOccurrences).set(encrypted).where(and(
      eq(completedOccurrences.taskId, taskId), eq(completedOccurrences.occurrenceId, occurrenceId),
    ));
  }
}

export async function rekeyWithActiveDek({ db, keys, tenantId }: ProductAccess) {
  let rewritten = 0;
  for (;;) {
    const pending = await withTenant(db, tenantId, async (tx) => {
      const [tenant] = await tx.select({ version: tenants.activeDekVersion }).from(tenants);
      if (!tenant) throw new Error("Tenant indisponível.");
      const records = await loadOlderRecords(tx, tenant.version);
      return { version: tenant.version, count: countRecords(records) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    if (!pending.count) return rewritten;
    rewritten += await withDekWrite(db, keys, tenantId, pending.count, async (tx, version, dek, tenant) => {
      if (version !== pending.version) return 0;
      const records = await loadOlderRecords(tx, version);
      // Under the same active DEK, concurrent application writes can only remove pending rows.
      const count = countRecords(records);
      if (count > pending.count) throw new Error("Lote de recifragem excedeu a reserva.");
      await withProductReader(tx, keys, tenantId, (reader) =>
        rewriteRecords(tx, tenantId, version, dek.key, reader, records), { version, dek });
      if (count) await advanceProductRevision(tx, tenant);
      return count;
    });
  }
}

import "server-only";
import { timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { defaultPreferences } from "@feito/core/domain/preferences";
import { inboxName } from "@feito/core/domain/product";
import { ApiError, notFound } from "@/server/errors";
import { countsFor, type PortableDocument } from "@/server/portability/document";
import { remapForImport } from "@/server/portability/remap";
import { invalidImport } from "@/server/portability/token";
import { importCounts } from "@/validation/portability";
import { defaultsForView } from "@feito/core/validation/product";
import type { Transaction } from "./client";
import { productEncoder, readPreferenceRecord, readProjectRecord, type ProductAccess } from "./product";
import { withDekWrite, withProductReader, type ProductReader } from "./product-crypto";
import {
  completedOccurrences, importOperations, labels, preferences, projects, sections, taskComments, taskLabels, tasks, tenants,
} from "./schema";
import { advanceProductRevision, withTenant } from "./tenant";
import { bootstrapWorkspace, writePreferences } from "./workspace";

const readOnlySnapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;
type EmptyWorkspace = { kind: "empty"; inboxId: string; inboxRevision: number; preferenceRevision: number };

async function inspectDestination(tx: Transaction, reader: ProductReader) {
  const rows = await tx.select().from(projects).limit(2);
  if (!rows.length) {
    const [tenant] = await tx.select({ id: tenants.id }).from(tenants);
    if (tenant) throw new Error("Entrada indisponível.");
    return { kind: "unprovisioned" as const };
  }
  if (rows.length !== 1 || !rows[0].isInbox) return { kind: "filled" as const };
  const content = await tx.execute<{ present: boolean }>(sql`
    select exists (select 1 from domain.tasks)
      or exists (select 1 from domain.sections)
      or exists (select 1 from domain.labels) as present
  `);
  if (content.rows[0].present) return { kind: "filled" as const };
  const [preference] = await tx.select().from(preferences);
  if (!preference) throw new Error("Preferências indisponíveis.");
  const settings = await readPreferenceRecord(reader, preference);
  const project = await readProjectRecord(reader, rows[0]);
  if (settings.timezone !== defaultPreferences.timezone || settings.theme !== defaultPreferences.theme
    || project.data.archived || project.data.name !== inboxName
    || project.data.view.layout !== defaultsForView.layout || project.data.view.sortMode !== defaultsForView.sortMode
    || project.data.view.showCompleted !== defaultsForView.showCompleted) {
    return { kind: "filled" as const };
  }
  return { kind: "empty", inboxId: project.id, inboxRevision: project.revision,
    preferenceRevision: preference.revision } satisfies EmptyWorkspace;
}

export async function destinationIsEmpty({ db, keys, tenantId }: ProductAccess) {
  const status = await withTenant(db, tenantId, (tx) => withProductReader(
    tx, keys, tenantId, (reader) => inspectDestination(tx, reader),
  ), readOnlySnapshot);
  return status.kind !== "filled";
}

export async function findReceipt(tx: Transaction, operationId: string) {
  const [row] = await tx.select().from(importOperations).where(eq(importOperations.operationId, operationId));
  if (!row) return null;
  const summary = importCounts.parse(row.summary);
  return { operationId, summary, fingerprint: row.fingerprint };
}

export function replay(receipt: NonNullable<Awaited<ReturnType<typeof findReceipt>>>, fingerprint: Buffer) {
  if (!timingSafeEqual(receipt.fingerprint, fingerprint)) {
    throw invalidImport([{ path: "", message: "A operação já foi usada com outro arquivo." }]);
  }
  return { operationId: receipt.operationId, summary: receipt.summary };
}

export async function getImportOperation({ db, tenantId }: ProductAccess, operationId: string) {
  const receipt = await withTenant(db, tenantId, (tx) => findReceipt(tx, operationId), readOnlySnapshot);
  if (!receipt) throw notFound();
  return { operationId, status: "completed" as const, summary: receipt.summary };
}

async function insertBatches<T, Row>(values: T[], encode: (record: T) => Row, insert: (rows: Row[]) => PromiseLike<unknown>) {
  const batchSize = 200;
  for (let start = 0; start < values.length; start += batchSize) {
    await insert(values.slice(start, start + batchSize).map(encode));
  }
}

async function storeDocument(
  tx: Transaction, tenant: typeof tenants.$inferSelect, key: Buffer, destination: EmptyWorkspace,
  document: PortableDocument, operationId: string, fingerprint: Buffer,
) {
  const tenantId = tenant.id;
  const version = tenant.activeDekVersion;
  const data = remapForImport(document, destination.inboxId, destination.inboxRevision);
  const encode = productEncoder(tenantId, version, key);
  const inbox = data.projects.find((project) => project.isInbox)!;
  await tx.update(projects).set(encode.project(inbox)).where(eq(projects.id, inbox.id));
  await writePreferences(tx, tenantId, version, key, destination.preferenceRevision + 1, document.preferences);

  await insertBatches(data.projects.filter((project) => !project.isInbox),
    (project) => ({ tenantId, id: project.id, isInbox: false, ...encode.project(project) }),
    (rows) => tx.insert(projects).values(rows));
  await insertBatches(data.sections,
    (section) => ({ tenantId, id: section.id, projectId: section.projectId, ...encode.section(section) }),
    (rows) => tx.insert(sections).values(rows));
  await insertBatches(data.labels, (label) => ({ tenantId, id: label.id, ...encode.label(label) }),
    (rows) => tx.insert(labels).values(rows));
  await insertBatches(data.tasks, (task) => ({ tenantId, id: task.id, ...encode.task(task) }),
    (rows) => tx.insert(tasks).values(rows));
  await insertBatches(data.taskLabels, (link) => ({ tenantId, ...link }),
    (rows) => tx.insert(taskLabels).values(rows));
  await insertBatches(data.occurrences, (occurrence) => ({ tenantId, ...encode.occurrence(occurrence) }),
    (rows) => tx.insert(completedOccurrences).values(rows));
  await insertBatches(data.comments, (comment) => ({ tenantId, ...encode.comment(comment) }),
    (rows) => tx.insert(taskComments).values(rows));

  const summary = countsFor(document);
  await tx.insert(importOperations).values({ tenantId, operationId, fingerprint, summary });
  await advanceProductRevision(tx, tenant);
  return { operationId, summary };
}

function occupied() {
  return new ApiError(409, "DESTINATION_NOT_EMPTY", "A conta de destino precisa estar vazia.");
}

export async function restoreDocument(
  { db, keys, tenantId }: ProductAccess, document: PortableDocument, operationId: string, fingerprint: Buffer,
) {
  // An already completed retry should not require any further key reservations.
  const state = await withTenant(db, tenantId, async (tx) => {
    const receipt = await findReceipt(tx, operationId);
    if (receipt) return { receipt };
    const destination = await withProductReader(tx, keys, tenantId, (reader) => inspectDestination(tx, reader));
    return { destination };
  }, readOnlySnapshot);
  if (state.receipt) return replay(state.receipt, fingerprint);
  if (state.destination.kind === "filled") throw occupied();

  const writes = 1 + document.projects.length + document.sections.length + document.labels.length
    + document.tasks.length + document.occurrences.length + (document.comments?.length ?? 0);
  if (state.destination.kind === "unprovisioned") {
    // The initial workspace and the restoration share one commit.
    const initial = await bootstrapWorkspace(db, keys, tenantId, writes, (tx, tenant, key, inboxId) =>
      storeDocument(tx, tenant, key, { kind: "empty", inboxId, inboxRevision: 1, preferenceRevision: 1 },
        document, operationId, fingerprint));
    if (initial) return initial.value;
  }

  return withDekWrite(db, keys, tenantId, writes, async (tx, version, dek, tenant) => {
    const receipt = await findReceipt(tx, operationId);
    if (receipt) return replay(receipt, fingerprint);
    const destination = await withProductReader(
      tx, keys, tenantId, (reader) => inspectDestination(tx, reader), { version, dek },
    );
    if (destination.kind !== "empty") throw occupied();
    return storeDocument(tx, tenant, dek.key, destination, document, operationId, fingerprint);
  });
}

import "server-only";
import { gt, lte } from "drizzle-orm";
import type { Transaction } from "./client";
import { desktopJournal } from "./schema";

const collections = ["projects", "sections", "tasks", "labels", "taskLabels", "occurrences"] as const;
type Collection = typeof collections[number];
export type DesktopJournalReferences = Partial<Record<Collection, string[]>> & { preferences?: true };

const retainedRevisions = 512;
const maxReferences = 1_000;

export async function writeDesktopRevision(
  tx: Transaction, tenantId: string, revision: number, references: DesktopJournalReferences,
) {
  const count = collections.reduce((total, collection) => total + (references[collection]?.length ?? 0), 0);
  // Uma revisão muito grande deixa uma lacuna e força a próxima base completa.
  if (count <= maxReferences) await tx.insert(desktopJournal).values({ tenantId, revision, references });
  if (revision > retainedRevisions) {
    await tx.delete(desktopJournal).where(lte(desktopJournal.revision, revision - retainedRevisions));
  }
}

export async function readDesktopRevisions(tx: Transaction, cursor: number, head: number) {
  if (cursor >= head || head - cursor > retainedRevisions) return;
  const rows = await tx.select({
    revision: desktopJournal.revision, references: desktopJournal.references,
  }).from(desktopJournal).where(gt(desktopJournal.revision, cursor)).orderBy(desktopJournal.revision);
  if (rows.length !== head - cursor || rows.some((row, index) => row.revision !== cursor + index + 1)) return;
  const combined: DesktopJournalReferences = {};
  let count = 0;
  for (const collection of collections) {
    const ids = new Set(rows.flatMap(({ references }) => references[collection] ?? []));
    count += ids.size;
    if (count > maxReferences) return;
    if (ids.size) combined[collection] = [...ids];
  }
  if (rows.some(({ references }) => references.preferences)) combined.preferences = true;
  return combined;
}

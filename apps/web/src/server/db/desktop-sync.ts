import "server-only";
import type { TaskField } from "@feito/core/product/port";
import { timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { sameGroup, type Task } from "@feito/core/domain/product";
import { ApiError } from "@/server/errors";
import type { Preferences } from "@feito/core/validation/preferences";
import type { Transaction } from "./client";
import { desktopOperations, desktopTaskClocks } from "./schema";

type TaskClockKey = TaskField | "deleted";
export type TaskFieldClocks = Partial<Record<TaskClockKey, string>>;
export type PreferenceClocks = Partial<Record<keyof Preferences, string>>;

export type DesktopOperation = {
  id: string;
  authoredAt: string;
  fingerprint: Buffer;
  generatedIds: readonly string[];
  task?: { id: string; field?: TaskField; creates?: boolean; newOccurrenceId?: string };
};

export type DesktopWriteResult = { outcome: "applied" } | { outcome: "ignored"; message: string };

const ignoredMessages: Record<string, string> = {
  NOT_FOUND: "O item ou seu destino foi excluído no servidor.",
  PROJECT_ARCHIVED: "O projeto de destino foi arquivado.",
  DESKTOP_EDIT_SUPERSEDED: "Uma alteração mais recente já foi aplicada.",
  DESKTOP_ID_UNAVAILABLE: "O identificador do item já foi usado no servidor.",
  OCCURRENCE_STALE: "A ocorrência já mudou no servidor.",
  UNDO_UNAVAILABLE: "A conclusão já mudou no servidor.",
  REVISION_CONFLICT: "O item mudou no servidor antes desta alteração.",
};

export class DesktopWriteOutcome extends Error {
  readonly result: DesktopWriteResult;

  constructor(ignoredReason: string | null) {
    super("Operação desktop registrada.");
    this.result = ignoredReason === null ? { outcome: "applied" } : {
      outcome: "ignored",
      message: ignoredMessages[ignoredReason] ?? "A alteração deixou de ser aplicável no servidor.",
    };
  }
}

export function desktopClock(authoredAt: string, id?: string) {
  // As chaves ISO em UTC ordenam por milissegundo. No empate o site prevalece.
  return `${new Date(authoredAt).toISOString()}/${id ?? "~"}`;
}

export async function readDesktopReceipt(tx: Transaction, operation: DesktopOperation) {
  const [receipt] = await tx.select({ fingerprint: desktopOperations.fingerprint, ignoredReason: desktopOperations.ignoredReason })
    .from(desktopOperations).where(eq(desktopOperations.id, operation.id));
  if (!receipt) return undefined;
  if (!timingSafeEqual(receipt.fingerprint, operation.fingerprint)) {
    throw new ApiError(409, "DESKTOP_OPERATION_REUSED", "O identificador pertence a outra alteração.");
  }
  return new DesktopWriteOutcome(receipt.ignoredReason);
}

export function writeDesktopReceipt(tx: Transaction, tenantId: string, operation: DesktopOperation, ignoredReason: string | null) {
  return tx.insert(desktopOperations).values({
    tenantId, id: operation.id, fingerprint: operation.fingerprint, ignoredReason,
  });
}

export async function readDesktopTaskClocks(tx: Transaction, operation: DesktopOperation) {
  if (!operation.task) return;
  const [row] = await tx.select({ clocks: desktopTaskClocks.clocks })
    .from(desktopTaskClocks).where(eq(desktopTaskClocks.taskId, operation.task.id));
  return row?.clocks;
}

type TaskChange = { id: string; previous?: Task; next: Task };
const taskFields: readonly TaskField[] = ["title", "description", "priority", "schedule", "placement", "labels", "completion"];

export async function writeDesktopTaskClocks(
  tx: Transaction, tenantId: string, clock: string,
  tasks: { upsert: TaskChange[]; removed: string[] },
  links: { upsert: { id: string }[]; removed: string[] },
  touched?: { id: string; fields: TaskField[] },
) {
  const byTask = new Map<string, TaskFieldClocks>();
  for (const { id, previous, next } of tasks.upsert) {
    if (!previous) {
      byTask.set(id, Object.fromEntries(taskFields.map((field) => [field, clock])));
      continue;
    }
    const clocks: TaskFieldClocks = {};
    for (const field of ["title", "description", "priority"] as const) {
      if (previous.data[field] !== next.data[field]) clocks[field] = clock;
    }
    const before = previous.data;
    const after = next.data;
    if (previous.occurrenceId !== next.occurrenceId || before.dueDate !== after.dueDate || before.dueTime !== after.dueTime) {
      clocks.schedule = clock;
    }
    if (before.completedAt !== after.completedAt) clocks.completion = clock;
    if (!sameGroup(previous, next) || before.position !== after.position) clocks.placement = clock;
    if (Object.keys(clocks).length) byTask.set(id, clocks);
  }
  for (const id of [...links.upsert.map(({ id }) => id), ...links.removed]) {
    byTask.set(id, { ...byTask.get(id), labels: clock });
  }
  if (touched?.fields.length) {
    byTask.set(touched.id, { ...byTask.get(touched.id), ...Object.fromEntries(touched.fields.map((field) => [field, clock])) });
  }
  for (const id of tasks.removed) byTask.set(id, { deleted: clock });

  const rows = [...byTask].map(([taskId, clocks]) => ({ tenantId, taskId, clocks }));
  for (let offset = 0; offset < rows.length; offset += 500) {
    await tx.insert(desktopTaskClocks).values(rows.slice(offset, offset + 500)).onConflictDoUpdate({
      target: [desktopTaskClocks.tenantId, desktopTaskClocks.taskId],
      set: {
        clocks: sql`${desktopTaskClocks.clocks} || (
          SELECT jsonb_object_agg(key, greatest(
            (excluded.clocks ->> key) COLLATE "C",
            (${desktopTaskClocks.clocks} ->> key) COLLATE "C"
          ))
          FROM jsonb_object_keys(excluded.clocks) AS fields(key)
        )`,
      },
    });
  }
}

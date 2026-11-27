import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { and, count, eq } from "drizzle-orm";
import type { TaskComment } from "@feito/core/domain/product";
import type { CommentContext, CommentTarget, CommentWrite } from "@feito/core/product/port";
import { ApiError, notFound } from "@/server/errors";
import type { Transaction } from "./client";
import { writeDesktopRevision } from "./desktop-journal";
import { DesktopWriteOutcome, readDesktopReceipt, writeDesktopReceipt } from "./desktop-sync";
import { productEncoder, readCommentRecord, readProjectRecord, readTaskRecord, type ProductAccess } from "./product";
import { withDekWrite, withProductReader, type OpenDek, type ProductReader } from "./product-crypto";
import { projects, taskComments, tasks, tenants } from "./schema";
import { advanceProductRevision, lockTenant, withTenant } from "./tenant";
import { ensureWorkspace } from "./workspace";

const readOnlySnapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

async function readTask(tx: Transaction, reader: ProductReader, id: string) {
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, id));
  return row ? readTaskRecord(reader, row) : undefined;
}

export async function readComments({ db, keys, tenantId }: ProductAccess, taskId: string) {
  await ensureWorkspace(db, keys, tenantId);
  return withTenant(db, tenantId, (tx) => withProductReader(tx, keys, tenantId, async (reader) => {
    const [task] = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId));
    if (!task) throw notFound();
    const rows = await tx.select().from(taskComments).where(eq(taskComments.taskId, taskId));
    const comments: TaskComment[] = [];
    for (const row of rows) comments.push(await readCommentRecord(reader, row));
    return comments;
  }), readOnlySnapshot);
}

type Snapshot = { revision: number; context?: CommentContext; error?: ApiError };

async function readSnapshot(access: ProductAccess, target: CommentTarget): Promise<Snapshot> {
  const { db, keys, tenantId, desktopOperation } = access;
  return withTenant(db, tenantId, async (tx) => {
    if (desktopOperation) {
      const replay = await readDesktopReceipt(tx, desktopOperation);
      if (replay) throw replay;
    }
    const [tenant] = await tx.select({ revision: tenants.productRevision }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new Error("Conta indisponível.");
    const context = await withProductReader(tx, keys, tenantId, async (reader) => {
      const [commentRow] = "commentId" in target
        ? await tx.select().from(taskComments).where(eq(taskComments.id, target.commentId)) : [];
      const taskId = "taskId" in target ? target.taskId : commentRow?.taskId;
      const task = taskId === undefined ? undefined : await readTask(tx, reader, taskId);
      if (!task) return undefined;
      const [projectRow] = await tx.select().from(projects).where(eq(projects.id, task.projectId));
      if (!projectRow) return undefined;
      const [{ total }] = await tx.select({ total: count() }).from(taskComments).where(eq(taskComments.taskId, task.id));
      const now = desktopOperation ? Temporal.Instant.from(desktopOperation.authoredAt) : Temporal.Now.instant();
      return {
        task, count: total, now: now.toString(),
        project: await readProjectRecord(reader, projectRow),
        comment: commentRow ? await readCommentRecord(reader, commentRow) : undefined,
      } satisfies CommentContext;
    });
    return context ? { revision: tenant.revision, context } : { revision: tenant.revision, error: notFound() };
  }, readOnlySnapshot);
}

type Outcome<T> = { value: T; write: Omit<CommentWrite<T>, "value"> } | { error: ApiError };

/**
 * Plans the write on a read snapshot, then commits only if the product revision did not move,
 * the same way product mutations do. Queued desktop operations keep their receipts.
 */
export async function mutateComments<T>(
  access: ProductAccess, target: CommentTarget, apply: (context: CommentContext) => CommentWrite<T>,
): Promise<T> {
  const { db, keys, tenantId, desktopOperation } = access;
  await ensureWorkspace(db, keys, tenantId);
  for (;;) {
    const snapshot = await readSnapshot(access, target);
    let outcome: Outcome<T>;
    try {
      if (snapshot.error) throw snapshot.error;
      const { value, ...write } = apply(snapshot.context!);
      outcome = { value, write };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      outcome = { error };
    }
    const changed = "write" in outcome ? outcome.write.upsert ?? outcome.write.remove : undefined;
    if (!changed && !desktopOperation) {
      if ("error" in outcome) throw outcome.error;
      return outcome.value;
    }

    const commit = async (tx: Transaction, version?: number, dek?: OpenDek, lockedTenant?: typeof tenants.$inferSelect) => {
      const tenant = lockedTenant ?? await lockTenant(tx, tenantId);
      if (tenant.productRevision !== snapshot.revision) return null;
      if (desktopOperation) {
        const replay = await readDesktopReceipt(tx, desktopOperation);
        if (replay) return replay;
        await writeDesktopReceipt(tx, tenantId, desktopOperation, "error" in outcome ? outcome.error.code : null);
        if ("error" in outcome) return new DesktopWriteOutcome(outcome.error.code);
      }
      if ("error" in outcome) throw outcome.error;
      const { upsert, remove } = outcome.write;
      if (!changed) return outcome;
      if (upsert) {
        if (!dek || version === undefined) throw new Error("Reserva criptográfica indisponível.");
        const { id, taskId, ...encrypted } = productEncoder(tenantId, version, dek.key).comment(upsert);
        if (upsert.revision > 1) await tx.update(taskComments).set(encrypted).where(eq(taskComments.id, id));
        else {
          const inserted = await tx.insert(taskComments).values({ tenantId, id, taskId, ...encrypted })
            .onConflictDoNothing().returning({ id: taskComments.id });
          if (!inserted.length) throw new ApiError(409, "DESKTOP_ID_UNAVAILABLE", "O identificador já foi usado.");
        }
      }
      if (remove) {
        await tx.delete(taskComments).where(and(eq(taskComments.id, remove.id), eq(taskComments.revision, remove.revision)));
      }
      await writeDesktopRevision(tx, tenantId, tenant.productRevision + 1, { comments: [changed.id] });
      await advanceProductRevision(tx, tenant);
      return outcome;
    };
    const result = "write" in outcome && outcome.write.upsert
      ? await withDekWrite(db, keys, tenantId, 1, commit)
      : await withTenant(db, tenantId, commit);
    if (result instanceof DesktopWriteOutcome) throw result;
    if (result) {
      if ("error" in result) throw result.error;
      return result.value;
    }
  }
}

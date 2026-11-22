import { entityId } from "@feito/core/validation/product";
import { handleLocal } from "@feito/core/product/local-executor";
import { canSync, queueOperation } from "@feito/core/product/replica";
import { accountReplica, localSpace, type BrowserProductRequest, type BrowserProductResult } from "../storage";
import type { createProfileStorage } from "./profile-storage";
import type { createSqliteStorage } from "./storage";

export function createSqliteProduct(
  storage: ReturnType<typeof createProfileStorage>,
  scoped: ReturnType<typeof createSqliteStorage>,
) {
  return async function execute(request: BrowserProductRequest): Promise<BrowserProductResult> {
    const { epoch, read, method, path, authoredAt, body, taskChanges } = request;
    for (let attempt = 0; attempt < 8; attempt++) {
      const summary = storage.summary();
      if (!summary) throw new Error("Missing SQLite workspace selection");
      const fail = (status: number, code: string, message: string) => ({
        status, summary, body: { error: { code, message } },
      });
      if (summary.selection.epoch !== epoch) return fail(409, "WORKSPACE_CHANGED", "O espaço de trabalho mudou durante a ação.");
      if (!summary.loaded || !summary.spaceId) return fail(409, "WORKSPACE_REQUIRED", "Abra um espaço para continuar.");
      const remote = summary.selection.space.kind === "account";
      if (remote && !read && !canSync(method, path)) {
        return fail(422, "BROWSER_UNAVAILABLE", "Esta ação requer uma conta conectada à instalação.");
      }
      const selected = { epoch, generation: summary.generation, spaceId: summary.spaceId };
      const taskSegment = /^\/tasks\/([^/]+)$/.exec(path)?.[1];
      const taskId = taskSegment && entityId.safeParse(taskSegment).data;
      if (taskId && method === "GET") {
        const result = await scoped.taskDetail(selected, taskId);
        if (result === "conflict") continue;
        return result ? { ...result, summary } : fail(404, "NOT_FOUND", "Recurso não encontrado.");
      }
      const projectSegment = /^\/projects\/([^/?]+)(?:\?|$)/.exec(path)?.[1];
      const projectId = projectSegment && entityId.safeParse(projectSegment).data;
      if (projectId && method === "GET") {
        const result = await scoped.projectDetail(selected, projectId, path);
        if (result === "conflict") continue;
        return result ? { ...result, summary } : fail(404, "NOT_FOUND", "Recurso não encontrado.");
      }
      const fields = body && typeof body === "object" ? body as Record<string, unknown> : undefined;
      if (taskId && method === "PATCH" && request.id && fields && Object.keys(fields).length === 2
        && typeof fields.title === "string" && typeof fields.revision === "number") {
        const result = await scoped.editTitle(selected, taskId, {
          id: request.id, authoredAt, taskChanges, body: { revision: fields.revision, title: fields.title },
        });
        if (result === "conflict") continue;
        if (!result) return fail(404, "NOT_FOUND", "Recurso não encontrado.");
        if (result !== "duplicate") {
          if (result.status >= 400) return { ...result, summary };
          return { ...result, committed: true, summary: storage.summary() ?? summary };
        }
        return fail(409, "REVISION_CONFLICT", "A alteração já foi gravada. Recarregue e tente de novo.");
      }

      const current = storage.read();
      if (current?.generation !== summary.generation) continue;
      const replica = accountReplica(current);
      const local = localSpace(current);
      const workspace = replica?.working ?? local?.workspace;
      if (!workspace) return fail(409, "WORKSPACE_REQUIRED", "Abra um espaço para continuar.");
      const operation = { id: request.id, method, path, body, authoredAt };
      const result = await handleLocal(workspace, {
        ...operation, revision: summary.generation, taskChanges,
        session: replica ? { user: replica.user, mustChangePassword: false } : undefined,
      });
      const reply = { status: result.status, body: result.body };
      if (read || result.status >= 400) return { ...reply, summary };
      const data = replica ? queueOperation(replica, operation, result) : { ...local, workspace: result.workspace };
      if (storage.commit(current.generation, { data })) {
        return { ...reply, committed: true, summary: storage.summary() ?? summary };
      }
    }
    const summary = storage.summary();
    if (!summary) throw new Error("Missing SQLite workspace selection");
    return { status: 409, summary, body: { error: {
      code: "REVISION_CONFLICT", message: "Os dados mudaram em outra aba. Tente de novo.",
    } } };
  };
}

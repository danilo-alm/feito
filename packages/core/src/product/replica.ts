import type { User } from "../types";
import { handleLocal, type LocalRequest, type LocalResult, type Workspace } from "./local-executor";

export type Operation = {
  id: string;
  authoredAt: string;
  method: string;
  path: string;
  body?: unknown;
  generatedIds?: string[];
};

export type Replica = {
  user: User;
  cursor: number;
  confirmed: Workspace;
  working: Workspace;
  pending: Operation[];
  notice?: string;
};

type TableChanges<Row> = { upsert: Row[]; remove: string[] };
type SnapshotChanges = {
  preferences?: Workspace["preferences"];
  projects?: TableChanges<Workspace["projects"][number]>;
  sections?: TableChanges<Workspace["sections"][number]>;
  tasks?: TableChanges<Workspace["tasks"][number]>;
  labels?: TableChanges<Workspace["labels"][number]>;
  taskLabels?: Workspace["taskLabels"];
  occurrences?: [string, Workspace["occurrences"]][];
};
type Snapshot = { cursor: number; workspace: Workspace | null; user: User; changes?: SnapshotChanges };

export type ReplicaUpdate = {
  remote?: Snapshot;
  fromCursor?: number;
  removed?: ReadonlySet<string>;
  notice?: string;
};

export type SyncReply = { status: number; body: unknown };
export type SyncRequest = (method: string, path: string, body?: unknown) => Promise<SyncReply>;

const syncPath = "/api/v1/desktop-sync";
const loginMessage = "Entre novamente para continuar a sincronização.";

export class ReplicaSyncError extends Error {
  readonly blocked?: string;
  readonly identityChanged: boolean;

  constructor(
    readonly state: "login" | "offline" | "error",
    message: string,
    options?: { blocked?: string; identityChanged?: boolean },
  ) {
    super(message);
    this.name = "ReplicaSyncError";
    this.blocked = options?.blocked;
    this.identityChanged = options?.identityChanged ?? false;
  }
}

function errorBody(reply: SyncReply) {
  return (reply.body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
}

function errorMessage(reply: SyncReply, fallback: string) {
  const message = errorBody(reply)?.message;
  return typeof message === "string" ? message : fallback;
}

export function canSync(method: string, path: string) {
  const pathname = path.split("?")[0];
  if (method === "PATCH" && pathname === "/preferences") return true;
  if (method === "POST" && /^\/(tasks|projects|labels)$/.test(pathname)) return true;
  if ((method === "PATCH" || method === "DELETE") && /^\/(tasks|projects|sections|labels)\/[^/]+$/.test(pathname)) return true;
  if (method === "POST" && /^\/tasks\/[^/]+\/(complete|reopen|undo-completion|move|duplicate)$/.test(pathname)) return true;
  if ((method === "PUT" || method === "DELETE") && /^\/tasks\/[^/]+\/recurrence$/.test(pathname)) return true;
  if (method === "POST" && /^\/projects\/[^/]+\/(archive|unarchive|sections)$/.test(pathname)) return true;
  if (method === "POST" && /^\/sections\/[^/]+\/move$/.test(pathname)) return true;
  return method === "PATCH" && /^\/projects\/[^/]+\/view$/.test(pathname);
}

export function queueOperation(
  replica: Replica, request: LocalRequest & { id?: string; authoredAt: string }, result: LocalResult,
): Replica {
  const operation: Operation = {
    id: request.id ?? globalThis.crypto.randomUUID(),
    method: request.method,
    path: request.path,
    authoredAt: request.authoredAt,
    body: result.operationBody ?? request.body,
    generatedIds: result.generatedIds,
  };
  return { ...replica, working: result.workspace, pending: [...replica.pending, operation] };
}

function isWorkspace(value: unknown): value is Workspace {
  const workspace = value as Workspace | null;
  return !!workspace?.preferences && [workspace.projects, workspace.sections, workspace.tasks, workspace.labels,
    workspace.taskLabels, workspace.occurrences].every(Array.isArray);
}

function applyTableChanges<Row extends { id: string }>(rows: Row[], changes?: TableChanges<Row>) {
  if (!changes) return rows;
  const result = new Map(rows.map((row) => [row.id, row]));
  for (const id of changes.remove) result.delete(id);
  for (const row of changes.upsert) result.set(row.id, row);
  return [...result.values()];
}

function applySnapshotChanges(workspace: Workspace, changes: SnapshotChanges): Workspace {
  const tasks = applyTableChanges(workspace.tasks, changes.tasks);
  const ids = new Set(tasks.map((task) => task.id));
  const taskLabels = new Map([...workspace.taskLabels, ...(changes.taskLabels ?? [])]);
  const replacedOccurrences = new Map(changes.occurrences);
  return {
    projects: applyTableChanges(workspace.projects, changes.projects),
    sections: applyTableChanges(workspace.sections, changes.sections),
    tasks,
    labels: applyTableChanges(workspace.labels, changes.labels),
    preferences: changes.preferences ?? workspace.preferences,
    taskLabels: [...taskLabels].filter(([id, labels]) => ids.has(id) && labels.length > 0),
    occurrences: [
      ...workspace.occurrences.filter(({ taskId }) => ids.has(taskId) && !replacedOccurrences.has(taskId)),
      ...[...replacedOccurrences].flatMap(([id, rows]) => ids.has(id) ? rows : []),
    ],
  };
}

async function replayPending(confirmed: Workspace, pending: Operation[]) {
  let working = confirmed;
  for (const operation of pending) {
    const replay = await handleLocal(working, { ...operation, replay: true });
    if (replay.status < 400) working = replay.workspace;
  }
  return working;
}

function requireIdentity(user: User, expectedId?: string) {
  if (expectedId !== undefined && user.id !== expectedId) {
    throw new ReplicaSyncError("login", "Entre com a conta vinculada a este espaço.", { identityChanged: true });
  }
}

async function readSnapshot(request: SyncRequest, path: string, userId?: string): Promise<Snapshot> {
  const reply = await request("GET", path);
  if (reply.status === 401 || reply.status === 403) throw new ReplicaSyncError("login", loginMessage);
  if (errorBody(reply)?.code === "DESKTOP_ACCOUNT_CHANGED") {
    throw new ReplicaSyncError("login", "Entre com a conta vinculada a este espaço.", { identityChanged: true });
  }
  const data = reply.body as Snapshot | null;
  if (reply.status !== 200 || !data || !Number.isSafeInteger(data.cursor) || data.cursor < 0
    || typeof data.user?.id !== "string" || typeof data.user.email !== "string"
    || (data.workspace !== null && (!isWorkspace(data.workspace) || data.changes !== undefined))
    || (data.changes !== undefined && (!data.changes || typeof data.changes !== "object" || Array.isArray(data.changes)))) {
    throw new Error(errorMessage(reply, "O servidor não oferece uma API de sincronização compatível."));
  }
  requireIdentity(data.user, userId);
  return data;
}

export async function downloadReplica(request: SyncRequest, userId?: string): Promise<Replica> {
  const remote = await readSnapshot(request, syncPath, userId);
  if (!remote.workspace) throw new Error("O servidor não devolveu a primeira cópia dos dados.");
  return { user: remote.user, cursor: remote.cursor, confirmed: remote.workspace, working: remote.workspace, pending: [] };
}

export async function reconcileReplica(replica: Replica, { remote, fromCursor, removed, notice }: ReplicaUpdate): Promise<Replica> {
  if (remote) requireIdentity(remote.user, replica.user.id);
  const cursor = remote?.cursor ?? replica.cursor;
  let changes = remote?.changes;
  if (remote && fromCursor !== undefined && fromCursor !== replica.cursor
    && (changes || cursor < replica.cursor)) {
    if (cursor !== replica.cursor) {
      throw new ReplicaSyncError("error", "A cópia local avançou durante a sincronização. Tente novamente.");
    }
    // Outra aba já gravou esta revisão. Aproveite a confirmação sem reaplicar o delta.
    changes = undefined;
  }
  if (cursor === replica.cursor && !remote?.workspace && !changes && !removed?.size
    && (!remote || remote.user.email === replica.user.email)) return replica;
  if (!remote?.workspace && !changes && cursor !== replica.cursor) {
    throw new Error("O servidor retornou uma cópia incompleta.");
  }
  const confirmed = remote?.workspace
    ?? (changes ? applySnapshotChanges(replica.confirmed, changes) : replica.confirmed);
  const pending = removed?.size ? replica.pending.filter((operation) => !removed.has(operation.id)) : replica.pending;
  return {
    ...replica,
    user: remote?.user ?? replica.user,
    cursor, confirmed, pending,
    working: await replayPending(confirmed, pending),
    notice: notice ?? replica.notice,
  };
}

export async function synchronizeReplica(
  replica: Replica,
  { request, reconcile, canPush }: {
    request: SyncRequest;
    reconcile: (update: ReplicaUpdate) => Promise<void>;
    canPush?: (operation: Operation) => boolean | Promise<boolean>;
  },
) {
  const read = (cursor: number) => readSnapshot(request, `${syncPath}?cursor=${cursor}&incremental=1`, replica.user.id);
  let online = false;
  try {
    const incoming = await read(replica.cursor);
    online = true;
    await reconcile({ remote: incoming, fromCursor: replica.cursor });
    const removed = new Set<string>();
    let notice: string | undefined;
    const confirm = async () => {
      if (!removed.size) return;
      // Drop the acknowledged prefix only when the containing snapshot has been committed.
      await reconcile({ remote: await read(incoming.cursor), fromCursor: incoming.cursor, removed, notice });
    };
    try {
      for (const operation of replica.pending.slice(0, 50)) {
        if (canPush && !(await canPush(operation))) break;
        const reply = await request("POST", syncPath, { ...operation, userId: replica.user.id });
        const identityChanged = errorBody(reply)?.code === "DESKTOP_ACCOUNT_CHANGED";
        if (reply.status === 401 || reply.status === 403 || identityChanged) {
          throw new ReplicaSyncError("login", loginMessage, { identityChanged });
        }
        const result = reply.body as { outcome?: string; message?: string } | null;
        if (reply.status !== 200 || (result?.outcome !== "applied" && result?.outcome !== "ignored")) {
          const rejected = reply.status >= 400 && reply.status < 500 && reply.status !== 408 && reply.status !== 429;
          throw new ReplicaSyncError("error", errorMessage(reply, "A operação ficou na fila para a próxima tentativa."),
            { blocked: rejected ? operation.id : undefined });
        }
        removed.add(operation.id);
        if (result.outcome === "ignored" || result.message) {
          notice = result.message || "Uma alteração pendente deixou de ser aplicável.";
        }
      }
    } catch (error) {
      await confirm().catch(() => undefined);
      throw error;
    }
    await confirm();
  } catch (error) {
    if (error instanceof ReplicaSyncError) throw error;
    const message = error instanceof Error ? error.message : "Não foi possível alcançar o servidor.";
    throw new ReplicaSyncError(online ? "error" : "offline", message);
  }
}

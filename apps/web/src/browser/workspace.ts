import { ApiError } from "@feito/core/product/errors";
import { handleLocal, newWorkspace } from "@feito/core/product/local-executor";
import {
  canSync, downloadReplica, queueOperation, reconcileReplica, ReplicaSyncError, synchronizeReplica,
  type ReplicaUpdate,
} from "@feito/core/product/replica";
import type { Session } from "@feito/core/types";
import { ApiFailure } from "@feito/ui/client/api";
import { accountReplica, localSpace, type BrowserRecord, type BrowserStorage, type BrowserUpdate } from "./storage";
import { isLocalPortability, localPortability, type Preview } from "./portability";

const apiPrefix = "/api/v1";
const loginPath = apiPrefix + "/auth/login";
const logoutPath = apiPrefix + "/auth/logout";
const sessionPath = apiPrefix + "/auth/session";
const passwordPath = apiPrefix + "/auth/password";
const remoteProduct = /^(?:\/import\/|\/projects\/[^/]+\/share$)/;

type Sync = "local" | "syncing" | "current" | "offline" | "login" | "error";
export type BrowserStatus = {
  ready: boolean;
  epoch: string;
  space: BrowserRecord["selection"]["space"];
  loaded: boolean;
  sync: Sync;
  pending: number;
  provisional: boolean;
  discovering?: boolean;
  error?: string;
  storageError?: boolean;
  blocked?: string;
  notice?: string;
};

type Options = {
  storage: BrowserStorage;
  network?: (url: string, init: RequestInit) => Promise<Response>;
  exclusive?: <T>(name: string, run: () => Promise<T>) => Promise<T>;
  changed?: () => void;
  onData?: () => void;
  onSwitch?: () => void;
};

export const initialStatus: BrowserStatus = {
  ready: false, epoch: "", space: { kind: "none" }, loaded: false, sync: "local", pending: 0, provisional: false,
};

const storageMessage = "Não foi possível abrir ou gravar os dados do Feito neste navegador. Verifique o espaço disponível e tente de novo.";
const unavailable = "Esta ação requer uma conta conectada à instalação.";
const signedOut = () => new ApiFailure(409, "WORKSPACE_CHANGED", "O espaço de trabalho mudou durante a ação.");
const noWorkspace = () => new ApiFailure(409, "WORKSPACE_REQUIRED", "Abra um espaço para continuar.");
const unavailableAction = () => new ApiFailure(422, "BROWSER_UNAVAILABLE", unavailable);
const responseError = (error: ApiFailure) => Response.json({
  error: { code: error.code, message: error.message, details: error.details },
}, { status: error.status });

function matches(record: BrowserRecord, epoch: string) {
  if (record.selection.epoch !== epoch) throw signedOut();
  return record;
}

export function createBrowserWorkspace({
  storage, network = (url, init) => globalThis.fetch(url, init),
  exclusive = (_name, run) => run(), changed = () => {}, onData = () => {}, onSwitch = () => {},
}: Options) {
  let status = initialStatus;
  let seenGeneration = -1;
  let activeRequests = new AbortController();
  let syncRequest: { epoch: string; promise: Promise<void> } | undefined;
  let connect: Promise<void> | undefined;
  let lastSync = 0;
  const listeners = new Set<() => void>();
  const previews = new Map<string, Preview>();

  function publish(next: BrowserStatus) {
    status = next;
    listeners.forEach((listener) => listener());
  }

  function observe(record: BrowserRecord, refresh = false) {
    if (record.generation < seenGeneration) return;
    const { space, epoch } = record.selection;
    const generationChanged = seenGeneration !== record.generation;
    const switched = status.epoch !== epoch;
    seenGeneration = record.generation;
    if (switched) {
      activeRequests.abort();
      activeRequests = new AbortController();
      lastSync = 0;
      previews.clear();
      onSwitch();
    }
    const account = accountReplica(record);
    if (!generationChanged && status.ready && !status.storageError) return;
    publish({
      ...(switched ? initialStatus : status),
      ready: true, epoch, space, loaded: !!record.data,
      discovering: record.selection.discoverSession && space.kind === "none" && (status.discovering ?? true),
      sync: space.kind !== "account" ? "local" : switched ? "syncing" : status.sync,
      pending: account?.pending.length ?? 0, notice: account?.notice, storageError: false,
    });
    if (refresh && !switched && generationChanged && record.data) onData();
  }

  async function refresh() {
    try {
      observe(await storage.read(), true);
    } catch {
      publish({ ...status, storageError: true, error: storageMessage });
    }
  }

  async function transact<T>(run: (record: BrowserRecord) => Promise<{ value: T; update?: BrowserUpdate }> | { value: T; update?: BrowserUpdate }) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const record = await storage.read();
      observe(record, true);
      const { value, update } = await run(record);
      if (!update) return value;
      if (await storage.commit(record.generation, update)) {
        try {
          observe(await storage.read());
        } finally {
          changed();
        }
        return value;
      }
    }
    throw new ApiFailure(409, "REVISION_CONFLICT", "Os dados mudaram em outra aba. Tente de novo.");
  }

  async function request(path: string, init: RequestInit = {}) {
    try {
      const timeout = AbortSignal.timeout?.(30_000);
      const signal = init.signal && timeout && AbortSignal.any
        ? AbortSignal.any([init.signal, timeout]) : init.signal ?? timeout;
      return await network(path, {
        ...init, credentials: "same-origin", cache: "no-store", redirect: "error", signal,
      });
    } catch {
      throw new ApiFailure(503, "NETWORK_ERROR", "Sem conexão com o servidor. Tente de novo.");
    }
  }

  async function readBound(epoch: string) {
    const record = await storage.read();
    observe(record, true);
    return matches(record, epoch);
  }

  async function accountRequest(epoch: string, path: string, init: RequestInit = {}) {
    const record = await readBound(epoch);
    const space = record.selection.space;
    if (space.kind !== "account") throw signedOut();
    const headers = new Headers(init.headers);
    headers.set("X-Feito-Account", space.user.id);
    const reply = await request(path, { ...init, headers, signal: activeRequests.signal });
    await readBound(epoch);
    return reply;
  }

  function syncTransport(epoch: string) {
    return async (method: string, path: string, body?: unknown) => {
      const reply = await accountRequest(epoch, path, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: reply.status, body: await reply.json().catch(() => null) };
    };
  }

  async function reconcile(epoch: string, update: ReplicaUpdate) {
    let applied = false;
    await transact(async (record) => {
      matches(record, epoch);
      const replica = accountReplica(record);
      if (!replica) throw noWorkspace();
      const data = await reconcileReplica(replica, update);
      applied = data !== replica;
      return { value: undefined, update: applied ? { data } : undefined };
    });
    if (applied && status.epoch === epoch) onData();
  }

  async function runSync(epoch: string, force: boolean, revision?: number) {
    await exclusive("sync", async () => {
      const current = await readBound(epoch);
      const space = current.selection.space;
      if (space.kind !== "account" || status.provisional || (status.sync === "login" && !force)) return;
      const replica = accountReplica(current);
      if (replica && !replica.pending.length && !force &&
        (revision === undefined ? Date.now() - lastSync < 5_000 : revision <= replica.cursor)) {
        if (status.sync === "syncing") publish({ ...status, sync: "current" });
        return;
      }
      publish({ ...status, sync: "syncing", error: undefined, blocked: undefined });
      const transport = syncTransport(epoch);
      try {
        if (replica) {
          await synchronizeReplica(replica, {
            request: transport,
            reconcile: (update) => reconcile(epoch, update),
            canPush: async (operation) =>
              accountReplica(await readBound(epoch))?.pending.some(({ id }) => id === operation.id) ?? false,
          });
        } else {
          const data = await downloadReplica(transport, space.user.id);
          await transact((record) => {
            matches(record, epoch);
            return { value: undefined, update: record.data ? undefined : { data } };
          });
        }
        if (status.epoch !== epoch) return;
        lastSync = Date.now();
        publish({ ...status, sync: "current" });
      } catch (failure) {
        if (status.epoch !== epoch) return;
        if (failure instanceof ApiFailure && failure.code === "WORKSPACE_CHANGED") return;
        const sync = failure instanceof ReplicaSyncError ? failure.state
          : failure instanceof ApiFailure && failure.code === "NETWORK_ERROR" ? "offline" : "error";
        const error = failure instanceof Error ? failure.message : storageMessage;
        const blocked = failure instanceof ReplicaSyncError ? failure.blocked : undefined;
        if (sync === "login" && !status.loaded) {
          const response = await accountRequest(epoch, sessionPath).catch(() => null);
          const session = response?.ok ? await response.json() as Session : undefined;
          if (status.epoch !== epoch) return;
          if (session?.user?.id === space.user.id && session.mustChangePassword) {
            publish({ ...status, sync, provisional: true });
            return;
          }
        }
        publish({ ...status, sync, error, blocked });
      }
    });
  }

  function sync({ force = false, revision }: { force?: boolean; revision?: number } = {}): Promise<void> {
    const { epoch, space } = status;
    if (space.kind !== "account") return Promise.resolve();
    if (syncRequest?.epoch === epoch) {
      if (revision !== undefined || force) return syncRequest.promise.then(() => {
        if (status.epoch === epoch) return sync({ force, revision });
      });
      return syncRequest.promise;
    }
    const promise = runSync(epoch, force, revision).catch((error: unknown) => {
      if (status.epoch === epoch && !(error instanceof ApiFailure && error.code === "WORKSPACE_CHANGED")) {
        publish({ ...status, sync: "error", error: storageMessage });
      }
    }).finally(() => {
      if (syncRequest?.promise === promise) syncRequest = undefined;
      if (status.epoch === epoch && status.sync === "current" && status.pending) void sync();
    });
    syncRequest = { epoch, promise };
    return promise;
  }

  async function markRevoked(token: string) {
    await transact(({ selection }) => ({
      value: undefined,
      update: selection.revokeSession === token ? { selection: { ...selection, revokeSession: undefined } } : undefined,
    }));
  }

  // Chamado com o lock de autenticação antes de qualquer login que substitua o cookie.
  async function revokeRemote() {
    const { selection } = await storage.read();
    if (!selection.revokeSession) return;
    const reply = await request(logoutPath, { method: "POST" });
    if (!reply.ok && reply.status !== 401) {
      throw new ApiFailure(503, "LOGOUT_PENDING", "Não foi possível encerrar a sessão anterior. Tente de novo.");
    }
    await markRevoked(selection.revokeSession);
  }

  async function activate(session: Session, epoch: string) {
    await transact((record) => {
      matches(record, epoch);
      return { value: undefined, update: {
        selection: {
          epoch: crypto.randomUUID(), space: { kind: "account", user: session.user }, discoverSession: false,
        },
      } };
    });
    if (status.space.kind !== "account" || status.space.user.id !== session.user.id) return;
    if (session.mustChangePassword) publish({ ...status, provisional: true, sync: "login" });
    else void sync();
  }

  function reconnect() {
    if (connect) return connect;
    connect = (async () => {
      await refresh();
      if (!status.ready || status.storageError) return;
      const current = await storage.read();
      if (current.selection.revokeSession || (current.selection.discoverSession && current.selection.space.kind === "none")) {
        await exclusive("auth", async () => {
          const { selection } = await storage.read();
          if (selection.revokeSession) {
            await revokeRemote();
            return;
          }
          if (!selection.discoverSession || selection.space.kind !== "none") return;
          const reply = await request(sessionPath);
          if (reply.ok) await activate(await reply.json() as Session, selection.epoch);
        });
      } else if (status.space.kind === "account") {
        await sync();
      }
    })().catch(() => undefined).finally(() => {
      connect = undefined;
      if (status.discovering) publish({ ...status, discovering: false });
    });
    return connect;
  }

  async function openLocal() {
    await transact((record) => {
      if (record.selection.space.kind === "local" && record.data) return { value: undefined };
      return { value: undefined, update: {
        selection: {
          ...record.selection, epoch: crypto.randomUUID(), space: { kind: "local" }, discoverSession: false,
        },
        localIfMissing: { workspace: newWorkspace() },
      } };
    });
  }

  async function logout(confirmedPending: boolean, epoch: string) {
    const completed = await transact((record) => {
      matches(record, epoch);
      const space = record.selection.space;
      if (space.kind !== "account") throw noWorkspace();
      const count = accountReplica(record)?.pending.length ?? 0;
      if (count && !confirmedPending) return { value: { pending: count } };
      return {
        value: { pending: 0 },
        update: {
          selection: {
            epoch: crypto.randomUUID(), space: { kind: "none" }, discoverSession: false, revokeSession: crypto.randomUUID(),
          },
          deleteAccount: space.user.id,
        },
      };
    });
    if (!completed.pending) void exclusive("auth", revokeRemote).catch(() => undefined);
    return completed;
  }

  async function login(init: RequestInit, epoch: string) {
    return exclusive("auth", async () => {
      await readBound(epoch);
      await revokeRemote();
      const reply = await request(loginPath, init);
      if (reply.ok) await activate(await reply.clone().json() as Session, epoch);
      return reply;
    });
  }

  async function discardRejected(id: string) {
    const { epoch } = status;
    if (status.blocked !== id) return;
    await exclusive("sync", () => reconcile(epoch, {
      removed: new Set([id]), notice: "Uma alteração rejeitada foi descartada neste navegador.",
    }));
    if (status.epoch === epoch) void sync({ force: true });
  }

  async function fetch(input: string, init: RequestInit) {
    const { epoch } = status;
    try {
      if (input.startsWith(apiPrefix + "/public/")) return await request(input, init);
      if (input === loginPath) return await login(init, epoch);
      if (input === sessionPath) return await accountRequest(epoch, input, init);
      if (input === passwordPath) {
        const reply = await exclusive("auth", () => accountRequest(epoch, input, init));
        if (reply.ok && status.epoch === epoch) {
          publish({ ...status, provisional: false, sync: "syncing", error: undefined });
          void sync({ force: true });
        }
        return reply;
      }

      const method = init.method ?? "GET";
      const path = input.slice(apiPrefix.length);
      const [pathname] = path.split("?");
      const record = await readBound(epoch);
      const account = accountReplica(record);
      const local = localSpace(record);
      if (!account && !local) throw noWorkspace();
      if (remoteProduct.test(pathname) && !isLocalPortability(pathname, !!local)) {
        if (!account) throw unavailableAction();
        if (status.sync === "login" || status.sync === "offline") throw unavailableAction();
        if (pathname.startsWith("/import/") && account.pending.length) {
          throw new ApiFailure(409, "SYNC_PENDING", "Sincronize as alterações pendentes antes de importar.");
        }
        const reply = await accountRequest(epoch, input, init);
        if (reply.status === 401 || reply.status === 403 || reply.status === 409) {
          const error = await reply.clone().json().catch(() => undefined);
          if (["UNAUTHENTICATED", "PASSWORD_CHANGE_REQUIRED", "DESKTOP_ACCOUNT_CHANGED"].includes(error?.error?.code)) {
            publish({ ...status, sync: "login", error: "Entre novamente para continuar a sincronização." });
          }
        }
        if (reply.ok && pathname.endsWith("/confirm")) await sync({ force: true });
        return reply;
      }

      if (isLocalPortability(pathname, !!local)) {
        return await localPortability({
          method, path, init, record, previews,
          read: () => readBound(epoch),
          commit: (run) => transact((current) => run(matches(current, epoch))),
        });
      }

      const read = method === "GET" || (method === "POST" && path === "/search");
      const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      const authoredAt = new Date().toISOString();
      const id = read ? undefined : crypto.randomUUID();
      const taskChanges = new Headers(init.headers).get("X-Feito-Task-Changes") === "1";
      const execute = async (current: BrowserRecord) => {
        matches(current, epoch);
        const local = localSpace(current);
        const replica = accountReplica(current);
        const workspace = replica?.working ?? local?.workspace;
        if (!workspace) throw noWorkspace();
        if (replica && !read && !canSync(method, path)) throw unavailableAction();
        const operation = { id, method, path, body, authoredAt };
        const result = await handleLocal(workspace, {
          ...operation, taskChanges, revision: current.generation,
          session: current.selection.space.kind === "account" ? { user: current.selection.space.user, mustChangePassword: false } : undefined,
        });
        const value = result.status === 204 ? new Response(null, { status: 204 }) : Response.json(result.body, { status: result.status });
        if (read || result.status >= 400) return { value };
        const data = replica ? queueOperation(replica, operation, result) : { ...local, workspace: result.workspace };
        return { value, update: { data } };
      };
      const reply = read ? (await execute(record)).value : await transact(execute);
      await readBound(epoch);
      if (!read && reply.ok && account) void sync();
      return reply;
    } catch (error) {
      return responseError(error instanceof ApiFailure ? error : error instanceof ApiError
        ? new ApiFailure(error.status, error.code, error.message, error.details)
        : new ApiFailure(503, "BROWSER_STORAGE", storageMessage));
    }
  }

  return {
    fetch, sync, reconnect, refresh, openLocal, logout, discardRejected,
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

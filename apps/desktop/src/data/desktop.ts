import { handleLocal, newWorkspace, type Workspace } from "./local";
import type { SQLiteSelection, SQLiteTitleEdit } from "@feito/core/product/sqlite-batches";
import type { Session } from "@feito/core/types";
import { entityId } from "@feito/core/validation/product";

import {
  canSync, downloadReplica, queueOperation, reconcileReplica, ReplicaSyncError, synchronizeReplica,
  type Replica, type ReplicaUpdate, type SyncReply,
} from "@feito/core/product/replica";

type Connected = Replica & { origin: string };

type Space = "local" | "server";
type Document = {
  version: 1;
  active: Space | "none";
  local?: Workspace;
  server?: Connected;
  previousServers?: Connected[];
};
function workspaceIdentity(value: Document) {
  if (value.active === "server") return value.server?.origin;
  if (value.active === "local") return value.local?.projects.find((project) => project.isInbox)?.id;
}
type Record = { generation: number; value: Document };

const openFailures = ["key-missing", "vault-unavailable", "unreadable", "newer-version", "storage"] as const;
/** Motivo pelo qual os dados locais não abriram; o código vem do armazenamento nativo. */
export type OpenFailure = (typeof openFailures)[number];

export function openFailure(error: unknown): OpenFailure {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return openFailures.find((failure) => failure === code) ?? "storage";
}

type SyncState = "local" | "login" | "offline" | "syncing" | "current" | "error";

type ServerStatus = { origin: string; email: string; pending: number; notice?: string };

function serverStatus(server: Connected): ServerStatus {
  return { origin: server.origin, email: server.user.email, pending: server.pending.length, notice: server.notice };
}

export type DesktopStatus = {
  ready: boolean;
  active: Space | "none";
  hasLocal: boolean;
  server?: ServerStatus;
  servers: ServerStatus[];
  sync: SyncState;
  error?: string;
  blocked?: string;
};

export type Bridge = {
  read(): Promise<Record | null>;
  write(generation: number | null, value: Document): Promise<Record>;
  reset?(): Promise<void>;
  readContext?(selection: SQLiteSelection, kind: "task" | "project", id: string): Promise<Workspace | null>;
  writeTitle?(edit: SQLiteTitleEdit): Promise<number>;
  request(origin: string, method: string, path: string, body?: unknown): Promise<SyncReply>;
};

const apiPrefix = "/api/v1";
const loginPath = apiPrefix + "/auth/login";
const logoutPath = apiPrefix + "/auth/logout";
const sessionPath = apiPrefix + "/auth/session";
const shareRoute = /^\/projects\/([^/]+)\/share$/;

function desktopOrigin(input: string) {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Informe o endereço HTTPS da instalação, sem caminho nem parâmetros.");
  }
  return url.origin;
}

function apiError(status: number, message: string, code = "DESKTOP_ERROR") {
  return Response.json({ error: { code, message } }, { status });
}

function response(reply: SyncReply) {
  return reply.status === 204 ? new Response(null, { status: 204 }) : Response.json(reply.body, { status: reply.status });
}

function errorMessage(reply: SyncReply, fallback: string) {
  const error = (reply.body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof error === "string" ? error : fallback;
}

export function createDesktop(bridge: Bridge, onRemoteChange: () => void, onWorkspaceSwitch = () => {}) {
  let saved: Record | undefined;
  let serial: Promise<unknown> = Promise.resolve();
  let syncing: Promise<void> | undefined;
  let signingIn = false;
  const shareRequests = new Set<Promise<Response>>();
  let authentication: "unknown" | "valid" | "required" = "unknown";
  const needsAuthentication = () => authentication === "required";
  let status: DesktopStatus = { ready: false, active: "none", hasLocal: false, servers: [], sync: "local" };
  const listeners = new Set<() => void>();

  function publish(sync = status.sync, error?: string, blocked?: string) {
    const data = saved?.value;
    const active = data?.active ?? "none";
    const server = data?.server && serverStatus(data.server);
    const previous = data?.previousServers?.map(serverStatus) ?? [];
    status = {
      ready: !!data,
      active,
      hasLocal: !!data?.local,
      server,
      servers: server ? [server, ...previous] : previous,
      sync: active === "server" ? sync : "local",
      error,
      blocked,
    };
    listeners.forEach((listener) => listener());
  }

  function locked<T>(run: () => Promise<T>): Promise<T> {
    const next = serial.then(run);
    serial = next.catch(() => undefined);
    return next;
  }

  async function init() {
    if (saved) return saved;
    const existing = await bridge.read();
    if (existing && existing.value.version !== 1) {
      throw Object.assign(new Error("Os dados locais foram gravados por outra versão do Feito."), { code: "newer-version" });
    }
    saved = existing ?? await bridge.write(null, { version: 1, active: "local", local: newWorkspace() });
    publish(saved.value.active === "server" ? "syncing" : "local");
    return saved;
  }

  /** Separa dados que não abrem mais e cria um espaço vazio. O nativo recusa os que ainda podem abrir. */
  function startOver(): Promise<void> {
    return locked(async () => {
      if (!saved) await bridge.reset?.();
      await init();
    });
  }

  async function commit(value: Document) {
    if (!saved) throw new Error("O armazenamento do Feito ainda não foi aberto.");
    saved = await bridge.write(saved.generation, value);
  }

  async function reconcile(update: ReplicaUpdate) {
    let visibleChanged = false;
    await locked(async () => {
      const { value } = await init();
      const server = value.server;
      if (!server) return;
      const next = await reconcileReplica(server, update);
      if (next === server) return;
      await commit({ ...value, server: { ...next, origin: server.origin } });
      visibleChanged = value.active === "server";
      publish(status.sync);
    });
    if (visibleChanged) onRemoteChange();
  }

  async function runSync() {
    const current = await locked(init);
    const server = current.value.server;
    if (current.value.active !== "server" || !server || signingIn || needsAuthentication()) return;

    publish("syncing");
    try {
      await synchronizeReplica(server, {
        request: (method, path, body) => bridge.request(server.origin, method, path, body),
        reconcile: async (update) => {
          authentication = "valid";
          await reconcile(update);
        },
        canPush: () => saved?.value.active === "server" && !signingIn,
      });
      publish("current");
    } catch (error) {
      if (!(error instanceof ReplicaSyncError)) throw error;
      if (error.state === "login") authentication = "required";
      if (error.identityChanged) await bridge.request(server.origin, "POST", logoutPath).catch(() => undefined);
      publish(error.state, error.message, error.blocked);
    }
  }

  function sync() {
    if (syncing) return syncing;
    if (signingIn) return Promise.resolve();
    syncing = runSync().catch(() => {
      publish("error", "Não foi possível carregar os dados para sincronizar.");
    }).finally(() => {
      syncing = undefined;
      if (authentication === "valid" && !signingIn && status.sync === "current" && status.server?.pending) void sync();
    });
    return syncing;
  }

  async function syncForRevision(origin: string, revision: number) {
    // A pull already in flight may have read the previous revision.
    await syncing;
    const value = saved?.value;
    if (value?.active === "server" && value.server?.origin === origin && value.server.cursor !== revision) {
      await sync();
    }
  }

  async function connect(input: string, email: string, password: string, editingOrigin?: string) {
    let origin: string;
    try {
      origin = desktopOrigin(input);
    } catch {
      throw new Error("Informe o endereço HTTPS da instalação, sem caminho nem parâmetros.");
    }
    if (signingIn) throw new Error("Já há uma conexão em andamento.");
    signingIn = true;
    try {
      await syncing;
      await Promise.all(shareRequests);
      const { value } = await locked(init);
      const editing = editingOrigin ? [value.server, ...(value.previousServers ?? [])]
        .find((server) => server?.origin === editingOrigin) : undefined;
      if (editingOrigin && !editing) throw new Error("Esta conexão não está mais disponível.");
      if (editing && origin !== editing.origin) {
        if (editing.pending.length) throw new Error("Sincronize as alterações pendentes antes de trocar o endereço do servidor.");
        if ([value.server, ...(value.previousServers ?? [])].some((server) => server?.origin === origin)) {
          throw new Error("Este endereço já tem uma conexão. Edite a conexão existente.");
        }
      }
      const wasCurrentOrigin = value.server?.origin === origin;
      const login = await bridge.request(origin, "POST", loginPath, { email: email.trim(), password });
      if (login.status !== 200) throw new Error(errorMessage(login, "Não foi possível entrar no servidor."));

      let workspaceSwitched = false;
      try {
        if ((login.body as { mustChangePassword?: boolean } | null)?.mustChangePassword) {
          throw new Error("Troque a senha provisória no site e depois entre aqui.");
        }
        const linked = await downloadReplica((method, path, body) => bridge.request(origin, method, path, body));

        await locked(async () => {
          const { value: latest } = await init();
          const servers = latest.previousServers ?? [];
          const latestEditing = editingOrigin ? [latest.server, ...servers].find((space) => space?.origin === editingOrigin) : undefined;
          if (editingOrigin && !latestEditing) throw new Error("Esta conexão não está mais disponível.");
          if (latestEditing && origin !== editingOrigin && latestEditing.pending.length) {
            throw new Error("Sincronize as alterações pendentes antes de trocar o endereço do servidor.");
          }
          const previous = latest.server?.origin === origin
            ? latest.server : servers.find((space) => space.origin === origin);
          const accountChanged = previous && previous.user.id !== linked.user.id;
          if (accountChanged && (!editing || previous.pending.length)) {
            if (editing) throw new Error("Sincronize as alterações pendentes antes de trocar a conta.");
            throw new Error("Use a mesma conta que já está vinculada a este endereço.");
          }

          const replica = previous && !accountChanged
            ? await reconcileReplica(previous, { remote: { user: linked.user, cursor: linked.cursor, workspace: linked.confirmed } })
            : linked;
          const server = { ...replica, origin };
          const previousServers = servers.filter((space) => space.origin !== origin && space.origin !== editingOrigin);
          if (latest.server && latest.server.origin !== origin && latest.server.origin !== editingOrigin) previousServers.push(latest.server);

          await commit({ ...latest, active: "server", server, previousServers });
          workspaceSwitched = latest.active !== "server" || latest.server?.origin !== origin || !!accountChanged;
          if (workspaceSwitched) onWorkspaceSwitch();
          authentication = "valid";
          publish("syncing");
        });
      } catch (error) {
        await bridge.request(origin, "POST", logoutPath).catch(() => undefined);
        if (wasCurrentOrigin) {
          authentication = "required";
          publish("login");
        }
        throw error;
      }
      if (editingOrigin && editingOrigin !== origin) {
        await bridge.request(editingOrigin, "POST", logoutPath).catch(() => undefined);
      }
      if (!workspaceSwitched) onRemoteChange();
    } finally {
      signingIn = false;
    }
    void sync();
  }

  async function updateConnection(previousOrigin: string, origin: string, email: string, password: string) {
    await connect(origin, email, password, previousOrigin);
  }

  async function discardRejected(id: string) {
    await syncing;
    if (status.blocked !== id) return;
    const current = await locked(init);
    const server = current.value.server;
    if (current.value.active !== "server" || !server?.pending.some((operation) => operation.id === id)) return;
    await reconcile({ removed: new Set([id]), notice: "Uma alteração rejeitada foi descartada neste dispositivo." });
    publish(authentication === "required" ? "login" : "syncing");
    void sync();
  }

  async function signOut() {
    if (signingIn) return;
    signingIn = true;
    try {
      await syncing;
      await Promise.all(shareRequests);
      authentication = "required";
      const { value } = await locked(init);
      if (value.server) {
        try {
          await bridge.request(value.server.origin, "POST", logoutPath);
        } finally {
          publish("login");
        }
      }
    } finally {
      signingIn = false;
    }
  }

  async function openServer(origin: string) {
    if (signingIn) throw new Error("Já há uma conexão em andamento.");
    signingIn = true;
    try {
      await syncing;
      await Promise.all(shareRequests);
      await locked(async () => {
        const { value } = await init();
        const current = value.server;
        if (value.active === "server" && current?.origin === origin) return;
        const previous = value.previousServers ?? [];
        const server = current?.origin === origin ? current : previous.find((space) => space.origin === origin);
        if (!server) return;
        const previousServers = previous.filter((space) => space.origin !== origin);
        if (current && current.origin !== origin) previousServers.push(current);
        await commit({ ...value, active: "server", server, previousServers });
        if (current?.origin !== origin) authentication = "unknown";
        onWorkspaceSwitch();
        publish(needsAuthentication() ? "login" : "syncing");
      });
    } finally {
      signingIn = false;
    }
    void sync();
  }

  async function switchSpace(active: Space) {
    if (active === "server") {
      const { value } = await locked(init);
      if (value.server) await openServer(value.server.origin);
      return;
    }
    await locked(async () => {
      const { value } = await init();
      if (value.active === "local" || !value.local) return;
      await commit({ ...value, active: "local" });
      onWorkspaceSwitch();
      publish();
    });
  }

  async function createLocal() {
    await locked(async () => {
      const { value } = await init();
      if (value.local) return;
      await commit({ ...value, active: "local", local: newWorkspace() });
      onWorkspaceSwitch();
      publish();
    });
  }

  async function deleteLocal() {
    await locked(async () => {
      const { value } = await init();
      if (!value.local) return;
      const wasActive = value.active === "local";
      await commit({ ...value, active: wasActive ? "none" : value.active, local: undefined });
      if (wasActive) {
        onWorkspaceSwitch();
        publish();
      } else {
        publish(status.sync, status.error, status.blocked);
      }
    });
  }

  async function requestShare(server: Connected, method: string, input: string, projectId: string) {
    const spaceChanged = () => saved?.value.active !== "server" || saved.value.server?.origin !== server.origin;
    const changed = () => apiError(409, "O espaço de trabalho mudou durante a ação.", "WORKSPACE_CHANGED");
    const loginRequired = () => {
      authentication = "required";
      const message = "Entre novamente no servidor para compartilhar este projeto.";
      publish("login", message);
      return apiError(401, message);
    };
    if (signingIn) return apiError(409, "Aguarde a conexão com o servidor.");
    if (needsAuthentication()) return loginRequired();
    if (!server.confirmed.projects.some((project) => project.id === projectId && !project.isInbox)) {
      return apiError(409, "Sincronize o projeto com o servidor para compartilhar.");
    }
    try {
      const session = await bridge.request(server.origin, "GET", sessionPath);
      if (spaceChanged()) return changed();
      if (session.status === 401) return loginRequired();
      if (session.status !== 200) return response(session);
      const identity = session.body as Session | null;
      if (identity?.user?.id !== server.user.id || identity.mustChangePassword) return loginRequired();
      if (signingIn || needsAuthentication()) return apiError(409, "A conexão com o servidor mudou. Tente de novo.");
      const reply = await bridge.request(server.origin, method, input);
      if (spaceChanged()) return changed();
      if (reply.status === 401 || (reply.body as { error?: { code?: string } } | null)?.error?.code === "PASSWORD_CHANGE_REQUIRED") {
        return loginRequired();
      }
      return response(reply);
    } catch {
      return apiError(503, "Sem conexão com o servidor. Tente de novo.");
    }
  }

  async function fetch(input: string, initRequest: RequestInit) {
    const method = initRequest.method ?? "GET";
    if (!input.startsWith(apiPrefix + "/")) return apiError(404, "Rota do Feito indisponível.");
    const path = input.slice(apiPrefix.length);
    const share = shareRoute.exec(path);
    const taskChanges = new Headers(initRequest.headers).get("X-Feito-Task-Changes") === "1";
    const startedIn = saved && workspaceIdentity(saved.value);
    let body: unknown;
    try {
      body = typeof initRequest.body === "string" ? JSON.parse(initRequest.body) : initRequest.body;
    } catch {
      return apiError(400, "Envie um corpo JSON válido.");
    }
    const read = method === "GET" || (method === "POST" && path === "/search");
    try {
      if (share) {
        const projectId = entityId.safeParse(share[1]);
        if (!projectId.success || body !== undefined || !["GET", "PUT", "DELETE"].includes(method)) {
          return apiError(400, "Requisição de compartilhamento inválida.");
        }
        const initialized = await locked(init);
        const { value } = saved ?? initialized;
        if (startedIn !== undefined && startedIn !== workspaceIdentity(value)) {
          return apiError(409, "O espaço de trabalho mudou durante a ação.", "WORKSPACE_CHANGED");
        }
        if (value.active !== "server" || !value.server) {
          return apiError(422, "Conecte-se a um servidor para compartilhar este projeto.");
        }
        const request = requestShare(value.server, method, input, projectId.data);
        shareRequests.add(request);
        try {
          return await request;
        } finally {
          shareRequests.delete(request);
        }
      }
      return await locked(async () => {
        const { value, generation } = await init();
        if (startedIn !== undefined && startedIn !== workspaceIdentity(value)) {
          return apiError(409, "O espaço de trabalho mudou durante a ação.", "WORKSPACE_CHANGED");
        }
        const server = value.active === "server" ? value.server : undefined;
        const workspace = server?.working ?? (value.active === "local" ? value.local : undefined);
        if (!workspace) return apiError(404, "Abra ou crie um espaço de trabalho.", "WORKSPACE_REQUIRED");
        if (server && !read && !canSync(method, path)) {
          return apiError(422, "Esta ação ainda não está disponível no espaço sincronizado.");
        }
        const spaceId = server ? `remote:${server.origin}:${server.user.id}` : workspaceIdentity(value);
        if (bridge.readContext && method === "GET" && spaceId) {
          const scope = /^\/(tasks|projects)\/([^/?]+)(?:\?|$)/.exec(path);
          const id = scope && entityId.safeParse(scope[2]).data;
          if (scope && id) {
            const context = await bridge.readContext(
              { spaceId, epoch: "", generation }, scope[1] === "tasks" ? "task" : "project", id,
            );
            return context ? response(await handleLocal(context, { method, path }))
              : apiError(404, "Recurso não encontrado.", "NOT_FOUND");
          }
        }
        const authoredAt = read ? undefined : new Date().toISOString();
        const result = await handleLocal(workspace, { method, path, body, taskChanges, authoredAt, revision: generation });
        if (result.status < 400 && !read) {
          const replica = server && authoredAt
            ? queueOperation(server, { method, path, authoredAt, body }, result) : undefined;
          const next = replica && server
            ? { ...value, server: { ...replica, origin: server.origin } }
            : { ...value, local: result.workspace };
          const taskSegment = method === "PATCH" && /^\/tasks\/([^/]+)$/.exec(path)?.[1];
          const taskId = taskSegment && entityId.safeParse(taskSegment).data;
          const fields = body && typeof body === "object" ? body as { title?: unknown; revision?: unknown } : undefined;
          if (bridge.writeTitle && taskId && fields && Object.keys(fields).length === 2
            && typeof fields.title === "string" && typeof fields.revision === "number") {
            const task = result.workspace.tasks.find(({ id }) => id === taskId);
            if (!spaceId || !task) throw new Error("Espaço ou tarefa mudou durante a ação.");
            const persisted = await bridge.writeTitle({
              selection: { spaceId, epoch: "", generation }, taskId, revision: fields.revision,
              title: task.data.title, operation: replica?.pending.at(-1),
            });
            saved = { value: next, generation: persisted };
          } else {
            await commit(next);
          }
          publish(status.sync, status.error, status.blocked);
          if (server && authentication !== "required") void sync();
        }
        if (path === "/me" && server && result.status === 200) {
          return response({ status: 200, body: { ...(result.body as object), user: server.user } });
        }
        return response(result);
      });
    } catch {
      return apiError(503, "Não foi possível abrir ou gravar os dados neste computador.");
    }
  }

  return {
    fetch, sync, syncForRevision, connect, updateConnection, signOut, switchSpace, openServer, createLocal, deleteLocal, discardRejected,
    initialize: () => locked(init).then(() => undefined),
    startOver,
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

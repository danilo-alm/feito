import { handleLocal, newWorkspace, type Workspace } from "./local";
import type { Session, User } from "@feito/core/types";
import { entityId } from "@feito/core/validation/product";

type Operation = {
  id: string;
  authoredAt: string;
  method: string;
  path: string;
  body?: unknown;
  generatedIds?: string[];
};

type Connected = {
  origin: string;
  user: User;
  cursor: number;
  confirmed: Workspace;
  working: Workspace;
  pending: Operation[];
  notice?: string;
};

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
type Reply = { status: number; body: unknown };
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
  request(origin: string, method: string, path: string, body?: unknown): Promise<Reply>;
};

const syncPath = "/api/v1/desktop-sync";
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

function response(reply: Reply) {
  return reply.status === 204 ? new Response(null, { status: 204 }) : Response.json(reply.body, { status: reply.status });
}

function errorMessage(reply: Reply, fallback: string) {
  const error = (reply.body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof error === "string" ? error : fallback;
}

function canSync(method: string, path: string) {
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

function snapshot(reply: Reply): Snapshot {
  const data = reply.body as Snapshot | null;
  if (reply.status !== 200 || !data || !Number.isSafeInteger(data.cursor) || data.cursor < 0
    || typeof data.user?.id !== "string" || typeof data.user.email !== "string"
    || (data.workspace !== null && (!isWorkspace(data.workspace) || data.changes !== undefined))
    || (data.changes !== undefined && (!data.changes || typeof data.changes !== "object" || Array.isArray(data.changes)))) {
    throw new Error(errorMessage(reply, "O servidor não oferece uma API de sincronização compatível."));
  }
  return data;
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
      throw new Error("Os dados locais foram gravados por outra versão do Feito.");
    }
    saved = existing ?? await bridge.write(null, { version: 1, active: "local", local: newWorkspace() });
    publish(saved.value.active === "server" ? "syncing" : "local");
    return saved;
  }

  async function commit(value: Document) {
    if (!saved) throw new Error("O armazenamento do Feito ainda não foi aberto.");
    saved = await bridge.write(saved.generation, value);
  }

  async function reconcile(remote: Snapshot | undefined, removed: Set<string>, notice?: string) {
    let visibleChanged = false;
    await locked(async () => {
      const { value } = await init();
      const server = value.server;
      if (!server || (remote && server.user.id !== remote.user.id)) return;
      const cursor = remote?.cursor ?? server.cursor;
      if (cursor === server.cursor && !remote?.workspace && !remote?.changes && !removed.size) return;
      if (!remote?.workspace && !remote?.changes && cursor !== server.cursor) {
        throw new Error("O servidor retornou uma cópia incompleta.");
      }
      const confirmed = remote?.workspace ?? (remote?.changes ? applySnapshotChanges(server.confirmed, remote.changes) : server.confirmed);
      const pending = server.pending.filter((operation) => !removed.has(operation.id));
      const working = await replayPending(confirmed, pending);
      await commit({
        ...value,
        server: { ...server, cursor, confirmed, working, pending, notice: notice ?? server.notice },
      });
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
    const read = async (cursor: number) => {
      const reply = await bridge.request(server.origin, "GET", syncPath + "?cursor=" + cursor + "&incremental=1");
      if (reply.status === 401 || reply.status === 403) {
        authentication = "required";
        throw new Error("Entre novamente para continuar a sincronização.");
      }
      const incoming = snapshot(reply);
      if (incoming.user.id !== server.user.id) {
        authentication = "required";
        await bridge.request(server.origin, "POST", logoutPath).catch(() => undefined);
        throw new Error("Entre com a conta vinculada a este espaço.");
      }
      authentication = "valid";
      return incoming;
    };

    let online = false;
    let blocked: string | undefined;
    try {
      const incoming = await read(server.cursor);
      online = true;
      await reconcile(incoming, new Set());
      const removed = new Set<string>();
      let notice: string | undefined;
      try {
        for (const operation of server.pending.slice(0, 50)) {
          if (saved?.value.active !== "server" || signingIn) break;
          const reply = await bridge.request(server.origin, "POST", syncPath, { ...operation, userId: server.user.id });
          if (reply.status === 401 || reply.status === 403 || (reply.body as { error?: { code?: string } } | null)?.error?.code === "DESKTOP_ACCOUNT_CHANGED") {
            authentication = "required";
            throw new Error("Entre novamente para continuar a sincronização.");
          }
          const result = reply.body as { outcome?: string; message?: string } | null;
          if (reply.status !== 200 || (result?.outcome !== "applied" && result?.outcome !== "ignored")) {
            if (reply.status >= 400 && reply.status < 500 && reply.status !== 408 && reply.status !== 429) {
              blocked = operation.id;
            }
            throw new Error(errorMessage(reply, "A operação ficou na fila para a próxima tentativa."));
          }
          removed.add(operation.id);
          if (result.outcome === "ignored" || result.message) {
            notice = result.message || "Uma alteração pendente deixou de ser aplicável.";
          }
        }
      } catch (error) {
        if (removed.size) {
          // Só retire o prefixo confirmado depois de gravar a cópia que contém essas operações.
          await read(incoming.cursor).then((remote) => reconcile(remote, removed, notice)).catch(() => undefined);
        }
        throw error;
      }
      if (removed.size) await reconcile(await read(incoming.cursor), removed, notice);
      publish("current");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível alcançar o servidor.";
      publish(needsAuthentication() ? "login" : online ? "error" : "offline", message, blocked);
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

  async function connect(input: string, email: string, password: string) {
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
      const wasCurrentOrigin = value.server?.origin === origin;
      const login = await bridge.request(origin, "POST", loginPath, { email: email.trim(), password });
      if (login.status !== 200) throw new Error(errorMessage(login, "Não foi possível entrar no servidor."));

      let workspaceSwitched = false;
      try {
        if ((login.body as { mustChangePassword?: boolean } | null)?.mustChangePassword) {
          throw new Error("Troque a senha provisória no site e depois entre aqui.");
        }
        const linked = snapshot(await bridge.request(origin, "GET", syncPath));
        if (!linked.workspace) throw new Error("O servidor não devolveu a primeira cópia dos dados.");
        const confirmed = linked.workspace;

        await locked(async () => {
          const { value: latest } = await init();
          const servers = latest.previousServers ?? [];
          const previous = latest.server?.origin === origin
            ? latest.server : servers.find((space) => space.origin === origin);
          if (previous && previous.user.id !== linked.user.id) {
            throw new Error("Use a mesma conta que já está vinculada a este endereço.");
          }

          const pending = previous?.pending ?? [];
          const server = {
            ...previous, origin, user: linked.user, cursor: linked.cursor, confirmed,
            working: await replayPending(confirmed, pending), pending,
          };
          const previousServers = servers.filter((space) => space.origin !== origin);
          if (latest.server && latest.server.origin !== origin) previousServers.push(latest.server);

          await commit({ ...latest, active: "server", server, previousServers });
          workspaceSwitched = latest.active !== "server" || latest.server?.origin !== origin;
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
      if (!workspaceSwitched) onRemoteChange();
    } finally {
      signingIn = false;
    }
    void sync();
  }

  async function discardRejected(id: string) {
    await syncing;
    if (status.blocked !== id) return;
    const current = await locked(init);
    const server = current.value.server;
    if (current.value.active !== "server" || !server?.pending.some((operation) => operation.id === id)) return;
    await reconcile(undefined, new Set([id]), "Uma alteração rejeitada foi descartada neste dispositivo.");
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
        const authoredAt = read ? undefined : new Date().toISOString();
        const result = await handleLocal(workspace, { method, path, body, taskChanges, authoredAt, revision: generation });
        if (result.status < 400 && !read) {
          if (server && authoredAt) {
            const operation = {
              id: crypto.randomUUID(), method, path, authoredAt, body: result.operationBody ?? body,
              generatedIds: result.generatedIds,
            };
            await commit({ ...value, server: { ...server, working: result.workspace, pending: [...server.pending, operation] } });
          } else {
            await commit({ ...value, local: result.workspace });
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
    fetch, sync, syncForRevision, connect, signOut, switchSpace, openServer, createLocal, deleteLocal, discardRejected,
    initialize: () => locked(init).then(() => undefined),
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

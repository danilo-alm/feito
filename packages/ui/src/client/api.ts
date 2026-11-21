import { translateMessage, translate as t } from "./locale";
// Cliente HTTP da API /api/v1. Usado pela interface no navegador e pelos testes de integração.
import type {
  CompleteResponse, CreateTask, EditTask, Frequency, ImportPreview, ImportResult, Label, LabelTasks, Layout,
  Me, MoveResponse, MoveTarget, NamedDetails, Navigation, ProjectDetails, Preferences, ProjectPage, ProjectShare, ProjectSummary, ProjectView,
  PublicProjectPage, ReopenResponse,
  SearchInput, SearchResult, Section, Session, SortMode, SourceImportPreview, SourceImportResult, TaskDetail, TaskMutation,
  TodayView, UndoCompletionInput, UndoCompletionResponse, UpcomingView,
} from "@feito/core/types";

import { cacheScope } from "./store";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

type Config = {
  base: string;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  onAuthFailure?: (code: "UNAUTHENTICATED" | "PASSWORD_CHANGE_REQUIRED") => void;
};

const config: Config = {
  base: "/api/v1",
  fetch: (input, init) => globalThis.fetch(input, init),
};

export function configureApi(next: Partial<Config>) {
  Object.assign(config, next);
}

const AUTH_PATHS = new Set(["/auth/login", "/auth/password", "/auth/session"]);

async function send(method: string, path: string, init: { body?: BodyInit; headers?: HeadersInit } = {}) {
  let response: Response;
  try {
    response = await config.fetch(config.base + path, {
      method,
      body: init.body,
      headers: init.headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiFailure(0, "NETWORK_ERROR", "Sem conexão com o servidor. Tente de novo.");
  }
  if (response.ok) return response;

  let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const failure = new ApiFailure(
    response.status,
    body?.error?.code ?? "INTERNAL_ERROR",
    body?.error?.message ?? "Não foi possível concluir a operação.",
    body?.error?.details,
  );
  const [pathname] = path.split("?");
  if (failure.code === "UNAUTHENTICATED" && !AUTH_PATHS.has(pathname)) config.onAuthFailure?.("UNAUTHENTICATED");
  if (failure.code === "PASSWORD_CHANGE_REQUIRED") config.onAuthFailure?.("PASSWORD_CHANGE_REQUIRED");
  throw failure;
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await send(method, path, { headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

const enc = encodeURIComponent;
const query = (values: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};

const downloadUrls = new Set<string>();

export function clearDownloadUrls() {
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls.clear();
}

async function download(path: string, fallback: string) {
  const scope = cacheScope();
  const response = await send("GET", path);
  const blob = await response.blob();
  if (scope !== cacheScope()) throw new ApiFailure(409, "WORKSPACE_CHANGED", "O espaço de trabalho mudou.");
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const fileName = encoded ? decodeURIComponent(encoded) : /filename="([^"]+)"/i.exec(disposition)?.[1] ?? fallback;
  const url = URL.createObjectURL(blob);
  downloadUrls.add(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => {
    if (downloadUrls.delete(url)) URL.revokeObjectURL(url);
  }, 1000);
}

function projectExportPath(projectId: string, format: string, options: Record<string, boolean>) {
  return `/projects/${enc(projectId)}/export?${new URLSearchParams({ format, ...Object.fromEntries(
    Object.entries(options).map(([name, value]) => [name, String(value)])) })}`;
}

export const api = {
  auth: {
    login: (email: string, password: string) => request<Session>("POST", "/auth/login", { email, password }),
    logout: () => request<void>("POST", "/auth/logout"),
    session: () => request<Session>("GET", "/auth/session"),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<void>("POST", "/auth/password", { currentPassword, newPassword }),
  },
  me: () => request<Me>("GET", "/me"),
  /** Leitura sem sessão de um projeto compartilhado por link. */
  publicProject: (token: string, includeCompleted?: boolean) =>
    request<PublicProjectPage>("GET", `/public/projects/${enc(token)}${query({ includeCompleted })}`),
  navigation: () => request<Navigation>("GET", "/navigation"),
  preferences: (patch: Partial<Preferences>) => request<Preferences>("PATCH", "/preferences", patch),

  projects: {
    list: (status: "active" | "archived" = "active") =>
      request<{ projects: ProjectSummary[] }>("GET", `/projects${query({ status })}`),
    create: (details: ProjectDetails) => request<ProjectSummary>("POST", "/projects", details),
    get: (id: string, includeCompleted?: boolean) =>
      request<ProjectPage>("GET", `/projects/${enc(id)}${query({ includeCompleted })}`),
    edit: (id: string, revision: number, patch: Partial<ProjectDetails & Pick<ProjectSummary, "defaultSectionName">>) =>
      request<ProjectSummary>("PATCH", `/projects/${enc(id)}`, { revision, ...patch }),
    setView: (id: string, view: Partial<{ layout: Layout; sortMode: SortMode; showCompleted: boolean }>) =>
      request<ProjectView>("PATCH", `/projects/${enc(id)}/view`, view),
    archive: (id: string, revision: number) => request<ProjectSummary>("POST", `/projects/${enc(id)}/archive`, { revision }),
    unarchive: (id: string, revision: number) =>
      request<ProjectSummary>("POST", `/projects/${enc(id)}/unarchive`, { revision }),
    remove: (id: string, revision: number) => request<void>("DELETE", `/projects/${enc(id)}${query({ revision })}`),
    share: (id: string) => request<ProjectShare>("GET", `/projects/${enc(id)}/share`),
    enableShare: (id: string) => request<ProjectShare>("PUT", `/projects/${enc(id)}/share`),
    disableShare: (id: string) => request<void>("DELETE", `/projects/${enc(id)}/share`),
  },

  sections: {
    create: (projectId: string, details: NamedDetails, anchor: { afterSectionId?: string; beforeSectionId?: string } = {}) =>
      request<Section>("POST", `/projects/${enc(projectId)}/sections`, { ...details, ...anchor }),
    edit: (id: string, revision: number, patch: Partial<NamedDetails>) =>
      request<Section>("PATCH", `/sections/${enc(id)}`, { revision, ...patch }),
    move: (id: string, revision: number, anchor: { afterSectionId?: string; beforeSectionId?: string }) =>
      request<{ sectionIds: string[] }>("POST", `/sections/${enc(id)}/move`, { revision, ...anchor }),
    remove: (id: string, revision: number) =>
      request<{ movedTaskCount: number }>("DELETE", `/sections/${enc(id)}${query({ revision })}`),
  },

  tasks: {
    create: (input: CreateTask) => request<TaskDetail>("POST", "/tasks", input),
    get: (id: string) => request<TaskDetail>("GET", `/tasks/${enc(id)}`),
    edit: (id: string, input: EditTask) => request<TaskDetail>("PATCH", `/tasks/${enc(id)}`, input),
    complete: (id: string, input: { revision: number; occurrenceId?: string; includeChildren?: boolean }) =>
      request<CompleteResponse>("POST", `/tasks/${enc(id)}/complete`, input),
    undoCompletion: (id: string, input: UndoCompletionInput) =>
      request<UndoCompletionResponse>("POST", `/tasks/${enc(id)}/undo-completion`, input),
    reopen: (id: string, revision: number) => request<ReopenResponse>("POST", `/tasks/${enc(id)}/reopen`, { revision }),
    remove: (id: string, revision: number, withChildren = false) =>
      request<void>("DELETE", `/tasks/${enc(id)}${query({ revision, withChildren: withChildren || undefined })}`),
    move: (id: string, revision: number, target: MoveTarget) =>
      request<MoveResponse>("POST", `/tasks/${enc(id)}/move`, { revision, target }),
    setRecurrence: (id: string, input: { revision: number; frequency: Frequency; anchorDate: string; time?: string | null }) =>
      request<TaskDetail>("PUT", `/tasks/${enc(id)}/recurrence`, input),
    clearRecurrence: (id: string, revision: number) =>
      request<TaskDetail>("DELETE", `/tasks/${enc(id)}/recurrence${query({ revision })}`),
  },

  labels: {
    list: () => request<{ labels: Label[] }>("GET", "/labels"),
    create: (name: string) => request<Label>("POST", "/labels", { name }),
    rename: (id: string, revision: number, name: string) => request<Label>("PATCH", `/labels/${enc(id)}`, { revision, name }),
    remove: (id: string, revision: number) => request<void>("DELETE", `/labels/${enc(id)}${query({ revision })}`),
    tasks: (id: string, cursor?: string) => request<LabelTasks>("GET", `/labels/${enc(id)}/tasks${query({ cursor })}`),
  },

  views: {
    today: (includeCompleted = false) =>
      request<TodayView>("GET", `/views/today${query({ includeCompleted: includeCompleted || undefined })}`),
    upcoming: (start?: string) => request<UpcomingView>("GET", `/views/upcoming${query({ start })}`),
  },

  search: (input: SearchInput) => request<SearchResult>("POST", "/search", input),

  portability: {
    exportUrl: () => `${config.base}/export`,
    /** Download de um projeto num modelo de `exportFormats`. */
    projectExportUrl: (projectId: string, format: string, options: Record<string, boolean>) =>
      config.base + projectExportPath(projectId, format, options),
    downloadBackup: () => download("/export", "feito-dados.json"),
    downloadProject: (projectId: string, format: string, options: Record<string, boolean>, fallback: string) =>
      download(projectExportPath(projectId, format, options), fallback),
    preview: async (file: Blob, operationId: string) => {
      const response = await send("POST", "/import/preview", {
        body: file, headers: { "Content-Type": "application/json", "X-Operation-Id": operationId },
      });
      return await response.json() as ImportPreview;
    },
    confirm: async (file: Blob, previewToken: string, operationId: string) => {
      const response = await send("POST", "/import/confirm", {
        body: file,
        headers: { "Content-Type": "application/json", "X-Preview-Token": previewToken, "X-Operation-Id": operationId },
      });
      return await response.json() as ImportResult;
    },
    operation: (operationId: string) =>
      request<ImportResult & { status: "completed" }>("GET", `/import/operations/${enc(operationId)}`),
    /** Corpo das importações de outros apps. Reenvie o mesmo Blob na confirmação. */
    sourceBody: async (files: File[], projectId?: string) => new Blob([JSON.stringify({
      files: await Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() }))),
      ...(projectId && { projectId }),
    })], { type: "application/json" }),
    sourcePreview: async (source: string, body: Blob, operationId: string) => {
      const response = await send("POST", `/import/sources/${enc(source)}/preview`, {
        body, headers: { "Content-Type": "application/json", "X-Operation-Id": operationId },
      });
      return await response.json() as SourceImportPreview;
    },
    sourceConfirm: async (source: string, body: Blob, previewToken: string, operationId: string) => {
      const response = await send("POST", `/import/sources/${enc(source)}/confirm`, {
        body,
        headers: { "Content-Type": "application/json", "X-Preview-Token": previewToken, "X-Operation-Id": operationId },
      });
      return await response.json() as SourceImportResult;
    },
  },
};

const taskPath = (id: string) => `/tasks/${enc(id)}`;
const taskWrite = <T>(method: string, path: string, body?: unknown) => request<TaskMutation<T>>(
  method, path, body, { "X-Feito-Task-Changes": "1" },
);

export const taskWrites = {
  create: (input: CreateTask) => taskWrite<TaskDetail>("POST", "/tasks", input),
  duplicate: (id: string) => taskWrite<TaskDetail>("POST", `${taskPath(id)}/duplicate`),
  edit: (id: string, input: EditTask) => taskWrite<TaskDetail>("PATCH", taskPath(id), input),
  move: (id: string, revision: number, target: MoveTarget) =>
    taskWrite<MoveResponse>("POST", `${taskPath(id)}/move`, { revision, target }),
  complete: (id: string, input: { revision: number; occurrenceId?: string; includeChildren?: boolean }) =>
    taskWrite<CompleteResponse>("POST", `${taskPath(id)}/complete`, input),
  reopen: (id: string, revision: number) => taskWrite<ReopenResponse>("POST", `${taskPath(id)}/reopen`, { revision }),
  undo: (id: string, input: UndoCompletionInput) =>
    taskWrite<UndoCompletionResponse>("POST", `${taskPath(id)}/undo-completion`, input),
  remove: (id: string, revision: number, withChildren: boolean) => taskWrite<null>(
    "DELETE", taskPath(id) + query({ revision, withChildren: withChildren || undefined }),
  ),
};

export function errorMessage(error: unknown) {
  return error instanceof ApiFailure ? translateMessage(error.message) : t("Não foi possível concluir a operação.");
}

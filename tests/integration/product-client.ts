import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect } from "vitest";
import { eq } from "drizzle-orm";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as changePassword } from "@/app/api/v1/auth/password/route";
import * as labels from "@/app/api/v1/labels/route";
import * as desktopSync from "@/app/api/v1/desktop-sync/route";
import * as label from "@/app/api/v1/labels/[id]/route";
import * as labelTasks from "@/app/api/v1/labels/[id]/tasks/route";
import * as navigation from "@/app/api/v1/navigation/route";
import * as projects from "@/app/api/v1/projects/route";
import * as project from "@/app/api/v1/projects/[id]/route";
import * as archive from "@/app/api/v1/projects/[id]/archive/route";
import * as unarchive from "@/app/api/v1/projects/[id]/unarchive/route";
import * as projectView from "@/app/api/v1/projects/[id]/view/route";
import * as projectExport from "@/app/api/v1/projects/[id]/export/route";
import * as projectShare from "@/app/api/v1/projects/[id]/share/route";
import * as publicProject from "@/app/api/v1/public/projects/[token]/route";
import * as createSectionRoute from "@/app/api/v1/projects/[id]/sections/route";
import * as section from "@/app/api/v1/sections/[id]/route";
import * as moveSectionRoute from "@/app/api/v1/sections/[id]/move/route";
import * as tasks from "@/app/api/v1/tasks/route";
import * as task from "@/app/api/v1/tasks/[id]/route";
import * as duplicate from "@/app/api/v1/tasks/[id]/duplicate/route";
import * as complete from "@/app/api/v1/tasks/[id]/complete/route";
import * as undoCompletion from "@/app/api/v1/tasks/[id]/undo-completion/route";
import * as reopen from "@/app/api/v1/tasks/[id]/reopen/route";
import * as move from "@/app/api/v1/tasks/[id]/move/route";
import * as recurrence from "@/app/api/v1/tasks/[id]/recurrence/route";
import * as today from "@/app/api/v1/views/today/route";
import * as upcoming from "@/app/api/v1/views/upcoming/route";
import * as search from "@/app/api/v1/search/route";
import * as preferences from "@/app/api/v1/preferences/route";
import * as me from "@/app/api/v1/me/route";
import * as download from "@/app/api/v1/export/route";
import * as preview from "@/app/api/v1/import/preview/route";
import * as confirm from "@/app/api/v1/import/confirm/route";
import * as operation from "@/app/api/v1/import/operations/[id]/route";
import * as sourcePreview from "@/app/api/v1/import/sources/[source]/preview/route";
import * as sourceConfirm from "@/app/api/v1/import/sources/[source]/confirm/route";
import { connectDatabase } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { getRuntime } from "@/server/runtime";
import { createAccount } from "@/server/services/admin";
import type { getNavigation, getProject } from "@/server/services/projects";
import type { completeTask, getTask, moveTask } from "@/server/services/tasks";

type Handler = (request: Request, context: { params: Promise<any> }) => Promise<Response>;
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type Resource = { id: string; revision: number };
export type ProjectPage = Awaited<ReturnType<typeof getProject>>;
export type Navigation = Awaited<ReturnType<typeof getNavigation>>;
export type Task = Awaited<ReturnType<typeof getTask>>;

const routes: Record<string, Partial<Record<Method, Handler>>> = {
  "/auth/login": { POST: login },
  "/auth/password": { POST: changePassword },
  "/desktop-sync": desktopSync,
  "/navigation": navigation,
  "/projects": projects,
  "/projects/:id": project,
  "/projects/:id/archive": archive,
  "/projects/:id/unarchive": unarchive,
  "/projects/:id/view": projectView,
  "/projects/:id/export": projectExport,
  "/projects/:id/share": projectShare,
  "/projects/:id/sections": createSectionRoute,
  "/sections/:id": section,
  "/sections/:id/move": moveSectionRoute,
  "/tasks": tasks,
  "/tasks/:id": task,
  "/tasks/:id/duplicate": duplicate,
  "/tasks/:id/complete": complete,
  "/tasks/:id/undo-completion": undoCompletion,
  "/tasks/:id/reopen": reopen,
  "/tasks/:id/move": move,
  "/labels": labels,
  "/labels/:id": label,
  "/labels/:id/tasks": labelTasks,
  "/tasks/:id/recurrence": recurrence,
  "/views/today": today,
  "/views/upcoming": upcoming,
  "/search": search,
  "/preferences": preferences,
  "/me": me,
  "/export": download,
  "/import/preview": preview,
  "/import/confirm": confirm,
  "/import/operations/:id": operation,
  "/import/sources/:source/preview": sourcePreview,
  "/import/sources/:source/confirm": sourceConfirm,
};

let runtime: ReturnType<typeof getRuntime>;
let admin: ReturnType<typeof connectDatabase>;

beforeAll(() => {
  process.env.AUTH_CLIENT_IP_HEADER = "x-feito-test-ip";
  runtime = getRuntime();
  admin = connectDatabase("IDENTITY_ADMIN_DATABASE_URL", 4);
});

afterAll(async () => {
  await Promise.all([runtime?.close(), admin?.close()]);
});

type RequestOptions = { raw?: string | Uint8Array<ArrayBuffer>; headers?: HeadersInit };

export function send(
  method: Method, path: string, cookie?: string, body?: unknown, originAllowed = true, options: RequestOptions = {},
) {
  const origin = runtime.identity.config.origin;
  const addr = randomBytes(4).toString("hex");
  const headers = new Headers({ "x-feito-test-ip": `2001:db8::${addr.slice(0, 4)}:${addr.slice(4)}` });
  if (originAllowed) headers.set("Origin", origin);
  if (cookie) headers.set("Cookie", cookie);
  if (body !== undefined || options.raw !== undefined) headers.set("Content-Type", "application/json");
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  const request = new Request(origin + "/api/v1" + path, {
    method, headers, body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const [pathname] = path.split("?");
  const shared = /^\/public\/projects\/([^/]+)$/.exec(pathname);
  if (shared && method === "GET") return publicProject.GET(request, { params: Promise.resolve({ token: shared[1] }) });
  const id = pathname.startsWith("/import/operations/") ? pathname.split("/").at(-1)! : pathname.split("/")[2] ?? "";
  const pattern = ["/projects/", "/sections/", "/tasks/", "/labels/", "/import/operations/"].some((prefix) => pathname.startsWith(prefix))
    ? pathname.replace(`/${id}`, "/:id") : pathname;
  const source = /^\/import\/sources\/([^/]+)\/(preview|confirm)$/.exec(pathname);
  if (source) {
    const handler = routes[`/import/sources/:source/${source[2]}`]?.[method];
    if (!handler) throw new Error(`Missing test route ${method} ${pathname}`);
    return handler(request, { params: Promise.resolve({ source: source[1] }) });
  }
  const handler = routes[pattern]?.[method];
  if (!handler) throw new Error(`Missing test route ${method} ${pattern}`);
  return handler(request, { params: Promise.resolve({ id }) });
}

export async function payload<T>(response: Response, status = 200) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return await response.json() as T;
}

export async function failure(response: Response, status: number, code: string) {
  const body = await payload<{ error: { code: string; message: string; details?: unknown } }>(response, status);
  expect(body.error).toMatchObject({ code, message: expect.any(String) });
  return body.error;
}

export async function accountFixture(provisional = false) {
  const email = `${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const store = { db: admin.db, config: runtime.identity.config };
  const id = await createAccount(store, email, password);
  const [identity] = await admin.db.select({ tenantId: user.tenantId }).from(user).where(eq(user.id, id));
  const response = await send("POST", "/auth/login", undefined, { email, password });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("__Secure-feito.session_token="))?.split(";")[0];
  expect(cookie).toBeDefined();
  const call = (method: Method, path: string, body?: unknown, options?: RequestOptions) =>
    send(method, path, cookie, body, true, options);
  if (!provisional) {
    const updated = await call("POST", "/auth/password", {
      currentPassword: password, newPassword: randomBytes(24).toString("base64url"),
    });
    expect(updated.status).toBe(204);
  }
  return Object.assign(call, { tenantId: identity.tenantId });
}

export type Client = Awaited<ReturnType<typeof accountFixture>>;

export const newProject = (call: Client, name = "Projeto") =>
  call("POST", "/projects", { name }).then((res) => payload<ProjectPage["project"]>(res, 201));
export const newSection = (call: Client, projectId: string, name = "Seção") =>
  call("POST", `/projects/${projectId}/sections`, { name }).then((res) => payload<Resource>(res, 201));
export const newLabel = (call: Client, name = "Etiqueta") =>
  call("POST", "/labels", { name }).then((res) => payload<Navigation["labels"][number]>(res, 201));
export const newTask = (call: Client, title: string, fields: Record<string, unknown> = {}) =>
  call("POST", "/tasks", { title, ...fields }).then((res) => payload<Task>(res, 201));
export const getTaskById = (call: Client, id: string) => call("GET", `/tasks/${id}`).then((res) => payload<Task>(res));
export const page = (call: Client, id: string, query = "") =>
  call("GET", `/projects/${id}${query}`).then((res) => payload<ProjectPage>(res));
export const nav = (call: Client) => call("GET", "/navigation").then((res) => payload<Navigation>(res));
export const completeTaskById = (call: Client, task: Resource, includeChildren?: boolean) =>
  call("POST", `/tasks/${task.id}/complete`, { revision: task.revision, includeChildren })
    .then((res) => payload<Awaited<ReturnType<typeof completeTask>>>(res));
export const position = (projectId: string, sectionId: string | null = null, parentId: string | null = null) =>
  ({ type: "position" as const, projectId, sectionId, parentId });
export const moveRequest = (call: Client, task: Resource, target: unknown) =>
  call("POST", `/tasks/${task.id}/move`, { revision: task.revision, target });
export const moveResult = (response: Response) => payload<Awaited<ReturnType<typeof moveTask>>>(response);

export function productAccess(client: Client) {
  return { db: runtime.db, keys: runtime.keys, tenantId: client.tenantId };
}

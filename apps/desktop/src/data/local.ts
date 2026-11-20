import type { ZodType } from "zod";
import type { Me, TaskChanges } from "@feito/core/types";
import { compareSearchKey, matchesSearch, normalizeSearchText, searchKey } from "@feito/core/domain/search";
import { ApiError, notFound } from "@feito/core/product/errors";
import { inboxProject, taskItemsWithOrigin } from "@feito/core/product/product-dto";
import { validation } from "@feito/core/product/product-rules";
import { preferencesPatch } from "@feito/core/validation/preferences";
import {
  completeTaskInput, createProjectInput, createSectionInput, createTaskInput, deleteQuery, editNameInput,
  editNamedDetailsInput, editProjectInput, editTaskInput, entityId, labelTasksQuery, nameInput, projectListQuery,
  projectPageQuery, projectViewPatch, revisionInput, searchInput, sectionMoveInput, setRecurrenceInput,
  taskDeleteQuery, taskMoveInput, todayQuery, undoTaskCompletionInput, upcomingQuery,
} from "@feito/core/validation/product";
import { createAgendaService } from "@feito/core/product/agenda";
import { createLabelsService } from "@feito/core/product/labels";
import type { ProductPort, TaskAccess } from "@feito/core/product/port";
import { createProjectsService } from "@feito/core/product/projects";
import { createTasksService } from "@feito/core/product/tasks";
import { randomUUID, withOperationIds } from "./local/crypto";
import {
  asProduct, mutateProduct, readProductSummary, readProjectView, readTaskDetail, readTaskView,
  type ProductAccess, type Workspace,
} from "./local/product";

const product: ProductPort<ProductAccess> = {
  requiresTaskRevision: () => true,
  allocateId: randomUUID, mutateProduct, readProductSummary, readProjectView, readTaskDetail, readTaskView,
};
const { getToday, getUpcoming } = createAgendaService(product);
const { createLabel, deleteLabel, listLabels, renameLabel } = createLabelsService(product);
const {
  createProject, createSection, deleteProject, deleteSection, editProject, editSection,
  getNavigation, getProject, listProjects, moveSection, setProjectArchived, updateProjectView,
} = createProjectsService(product);
const {
  completeTask, createTask, deleteTask, duplicateTask, editTask, getTask, moveTask,
  removeRecurrence, reopenTask, setRecurrence, undoTaskCompletion,
} = createTasksService(product);

export { newWorkspace, type Workspace } from "./local/product";

export type LocalRequest = {
  method: string;
  path: string;
  body?: unknown;
  taskChanges?: boolean;
  authoredAt?: string;
  revision?: number;
  replay?: boolean;
  generatedIds?: string[];
};

type LocalResult = {
  status: number;
  body: unknown;
  workspace: Workspace;
  operationBody?: unknown;
  generatedIds?: string[];
};

type RouteRequest = {
  access: TaskAccess<ProductAccess>;
  method: string;
  url: URL;
  body: unknown;
};

const localUser = { id: "57c8cdab-838a-4538-a3ef-6b3933aff16b", email: "" };
const session = { user: localUser, mustChangePassword: false };

function parse<T>(schema: ZodType<T>, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map(({ path, message }) => [path.join("."), message]));
    throw new ApiError(422, "VALIDATION_FAILED", "Revise os campos enviados.", { fieldErrors });
  }
  return parsed.data;
}

function idFrom(id: string | undefined) {
  const parsed = entityId.safeParse(id);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

function json(body: unknown, status = 200) {
  return { status, body };
}

async function getLabelTasks(access: TaskAccess<ProductAccess>, id: string, limit: number, cursor?: string) {
  const after = cursor ? idFrom(cursor) : undefined;
  return readTaskView(access, {
    operation: "label", labelId: id, page: { after: () => after, limit: limit + 1 },
  }, async (view) => {
    const tasks = Array.from(view.candidates.values()).slice(0, limit);
    const items = taskItemsWithOrigin(await view.contextFor(tasks));
    return {
      referenceDate: view.referenceDate, tasks: tasks.map(items),
      nextCursor: view.candidates.size > limit ? tasks.at(-1)!.id : null,
    };
  });
}

function getSearch(access: TaskAccess<ProductAccess>, input: ReturnType<typeof searchInput.parse>) {
  const text = normalizeSearchText(input.text ?? "");
  const { projectId, labelId, priority, date, cursor, limit } = input;
  const hasCriteria = Boolean(text || projectId || labelId || priority !== undefined || date);
  return readTaskView(access, { operation: "search", projectId, labelId, skipTasks: !hasCriteria }, async (view) => {
    const { referenceDate } = view;
    const results = [...view.candidates.values()]
      .filter((task) => matchesSearch(task, input, text, referenceDate))
      .sort((a, b) => compareSearchKey(searchKey(a), searchKey(b)));
    let after: ReturnType<typeof searchKey> | undefined;
    if (cursor) {
      const [completed, id, extra] = cursor.split(".");
      if (extra !== undefined || (completed !== "0" && completed !== "1") || !entityId.safeParse(id).success) {
        throw validation("cursor", "A página solicitada é inválida.");
      }
      after = { completed: completed === "1", id };
    }
    const start = after ? results.findIndex((task) => compareSearchKey(searchKey(task), after) > 0) : 0;
    const tasks = start < 0 ? [] : results.slice(start, start + limit);
    const items = taskItemsWithOrigin(await view.contextFor(tasks));
    const last = tasks.at(-1);
    return {
      referenceDate, results: tasks.map(items),
      nextCursor: last && start + tasks.length < results.length ? `${Number(last.data.completedAt !== null)}.${last.id}` : null,
    };
  });
}

async function taskRoute({ access, method, url, body }: RouteRequest, idText?: string, action?: string) {
  const query = Object.fromEntries(url.searchParams);
  if (!idText && !action && method === "POST") {
    return json(await createTask(access, parse(createTaskInput, body)), 201);
  }
  const id = idFrom(idText);
  if (!action) {
    if (method === "GET") return json(await getTask(access, id));
    if (method === "PATCH") return json(await editTask(access, id, parse(editTaskInput, body)));
    if (method === "DELETE") {
      const { revision, withChildren } = parse(taskDeleteQuery, query);
      await deleteTask(access, id, revision, withChildren);
      return json(null, 204);
    }
  }
  if (action === "recurrence") {
    if (method === "PUT") return json(await setRecurrence(access, id, parse(setRecurrenceInput, body)));
    if (method === "DELETE") {
      return json(await removeRecurrence(access, id, parse(deleteQuery, query).revision));
    }
  }
  if (method === "POST") {
    if (action === "duplicate") return json(await duplicateTask(access, id), 201);
    if (action === "move") return json(await moveTask(access, id, parse(taskMoveInput, body)));
    if (action === "complete") return json(await completeTask(access, id, parse(completeTaskInput, body)));
    if (action === "reopen") return json(await reopenTask(access, id, parse(revisionInput, body).revision));
    if (action === "undo-completion") return json(await undoTaskCompletion(access, id, parse(undoTaskCompletionInput, body)));
  }
  throw notFound();
}

async function projectRoute({ access, method, url, body }: RouteRequest, idText?: string, action?: string) {
  const query = Object.fromEntries(url.searchParams);
  if (!idText) {
    if (method === "GET") return json(await listProjects(access, parse(projectListQuery, query).status));
    if (method === "POST") return json(await createProject(access, parse(createProjectInput, body)), 201);
  }
  const id = idFrom(idText);
  if (action === "sections" && method === "POST") {
    const { name, description, ...anchor } = parse(createSectionInput, body);
    return json(await createSection(access, id, { name, description }, anchor), 201);
  }
  if ((action === "archive" || action === "unarchive") && method === "POST") {
    return json(await setProjectArchived(access, id, parse(revisionInput, body).revision, action === "archive"));
  }
  if (action === "view" && method === "PATCH") {
    return json(await updateProjectView(access, id, parse(projectViewPatch, body)));
  }
  if (action === "share" && method === "GET") return json({ enabled: false, token: null });
  if (!action) {
    if (method === "GET") return json(await getProject(access, id, parse(projectPageQuery, query).includeCompleted));
    if (method === "PATCH") {
      const { revision, ...patch } = parse(editProjectInput, body);
      return json(await editProject(access, id, revision, patch));
    }
    if (method === "DELETE") {
      await deleteProject(access, id, parse(deleteQuery, query).revision);
      return json(null, 204);
    }
  }
  throw notFound();
}

async function sectionRoute({ access, method, url, body }: RouteRequest, id: string, action?: string) {
  if (action === "move" && method === "POST") {
    const { revision, ...anchor } = parse(sectionMoveInput, body);
    return json(await moveSection(access, id, revision, anchor));
  }
  if (!action) {
    if (method === "PATCH") {
      const { revision, ...patch } = parse(editNamedDetailsInput, body);
      return json(await editSection(access, id, revision, patch));
    }
    if (method === "DELETE") {
      const { revision } = parse(deleteQuery, Object.fromEntries(url.searchParams));
      return json(await deleteSection(access, id, revision));
    }
  }
  throw notFound();
}

async function labelRoute({ access, method, url, body }: RouteRequest, idText?: string, action?: string) {
  if (!idText) {
    if (method === "GET") return json(await listLabels(access));
    if (method === "POST") return json(await createLabel(access, parse(nameInput, body).name), 201);
  }
  const id = idFrom(idText);
  const query = Object.fromEntries(url.searchParams);
  if (action === "tasks" && method === "GET") {
    const { limit, cursor } = parse(labelTasksQuery, query);
    return json(await getLabelTasks(access, id, limit, cursor));
  }
  if (!action) {
    if (method === "PATCH") {
      const { revision, name } = parse(editNameInput, body);
      return json(await renameLabel(access, id, revision, name));
    }
    if (method === "DELETE") {
      await deleteLabel(access, id, parse(deleteQuery, query).revision);
      return json(null, 204);
    }
  }
  throw notFound();
}

async function handleRoute(request: RouteRequest) {
  const { access, method, url, body } = request;
  const [root, id, action, extra] = url.pathname.slice(1).split("/");
  if (extra !== undefined) throw notFound();
  if (root === "tasks") return taskRoute(request, id, action);
  if (root === "projects") return projectRoute(request, id, action);
  if (root === "sections") return sectionRoute(request, idFrom(id), action);
  if (root === "labels") return labelRoute(request, id, action);

  switch (`${method} ${url.pathname}`) {
    case "GET /me": {
      const product = asProduct(access.workspace);
      return json({
        ...session, preferences: access.workspace.preferences,
        inboxProjectId: inboxProject(product).id, referenceDate: product.referenceDate,
      } satisfies Me);
    }
    case "GET /auth/session":
      return json(session);
    case "GET /navigation":
      return json(await getNavigation(access));
    case "PATCH /preferences": {
      const patch = parse(preferencesPatch, body);
      const preferences = { ...access.workspace.preferences, ...patch };
      access.workspace = { ...access.workspace, preferences };
      return json(preferences);
    }
    case "GET /views/today": {
      const { includeCompleted } = parse(todayQuery, Object.fromEntries(url.searchParams));
      return json(await getToday(access, includeCompleted));
    }
    case "GET /views/upcoming": {
      const { start } = parse(upcomingQuery, Object.fromEntries(url.searchParams));
      return json(await getUpcoming(access, start));
    }
    case "POST /search":
      return json(await getSearch(access, parse(searchInput, body)));
    default:
      throw notFound();
  }
}

function asFields(body: unknown) {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : undefined;
}

function replayBody(workspace: Workspace, url: URL, method: string, body: unknown) {
  const [collection, id] = url.pathname.slice(1).split("/");
  const entries = {
    tasks: workspace.tasks, projects: workspace.projects, sections: workspace.sections, labels: workspace.labels,
  };
  if (!Object.hasOwn(entries, collection)) return body;
  const record = entries[collection as keyof typeof entries].find((item) => item.id === id);
  if (!record) return body;
  if (method === "DELETE" && url.searchParams.has("revision")) {
    url.searchParams.set("revision", String(record.revision));
  }
  const fields = asFields(body);
  return fields && "revision" in fields ? { ...fields, revision: record.revision } : body;
}

export async function handleLocal(workspace: Workspace, request: LocalRequest): Promise<LocalResult> {
  let changes: TaskChanges | undefined;
  const access: TaskAccess<ProductAccess> = {
    workspace, revision: request.revision ?? 0, authoredAt: request.authoredAt,
    receiveChanges: (value) => { changes = value; },
  };
  try {
    const url = new URL(request.path, "https://feito.invalid");
    if (url.origin !== "https://feito.invalid" || !request.path.startsWith("/")) throw notFound();
    const isTaskCreation = request.method === "POST" && url.pathname === "/tasks";
    let body = request.replay ? replayBody(workspace, url, request.method, request.body) : request.body;
    let supplied = request.generatedIds ?? [];
    const fields = asFields(body);
    if (isTaskCreation && fields && "id" in fields) {
      const { id, ...rest } = fields;
      const requestedId = parse(entityId, id);
      if (supplied.length && supplied[0] !== requestedId) {
        throw validation("id", "O identificador da tarefa mudou.");
      }
      supplied = supplied.length ? supplied : [requestedId];
      body = rest;
    }
    const { result, generatedIds } = withOperationIds(supplied, () => handleRoute({ access, method: request.method, url, body }));
    const response = await result;
    const operationBody = isTaskCreation && generatedIds.length ? { ...asFields(body), id: generatedIds[0] } : body;
    const metadata = { workspace: access.workspace, operationBody, generatedIds };
    if (!changes || !request.taskChanges) return { ...response, ...metadata };
    return { ...json({ result: response.body, changes }, response.status === 204 ? 200 : response.status), ...metadata };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const { status, code, message, details } = error;
    return { status, body: { error: { code, message, details } }, workspace };
  }
}

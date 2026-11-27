import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { DesktopWriteOutcome, type DesktopOperation, type DesktopWriteResult } from "@/server/db/desktop-sync";
import type { ProductAccess } from "@/server/db/product";
import { ensureWorkspace, persistPreferences } from "@/server/db/workspace";
import { ApiError } from "@/server/errors";
import { preferencesPatch } from "@feito/core/validation/preferences";
import {
  completeTaskInput, createProjectInput, createSectionInput, createTaskInput, deleteQuery, editNameInput,
  editNamedDetailsInput, editProjectInput, editTaskInput, entityId, instant, nameInput, orderMoveInput, projectMoveInput, projectViewPatch,
  revisionInput, sectionMoveInput, setRecurrenceInput, taskDeleteQuery, taskMoveInput, undoTaskCompletionInput,
} from "@feito/core/validation/product";
import { createLabel, deleteLabel, moveLabel, renameLabel } from "./labels";
import {
  createProject, createSection, deleteProject, deleteSection, editProject, editSection,
  moveProject, moveSection, setProjectArchived, updateProjectView,
} from "./projects";
import {
  completeTask, createTask, deleteTask, duplicateTask, editTask, moveTask, removeRecurrence, reopenTask,
  setRecurrence, undoTaskCompletion,
} from "./tasks";

export const desktopCursorQuery = z.strictObject({
  cursor: z.string().regex(/^\d{1,10}$/).transform(Number).pipe(z.number().int().max(2147483647)).optional(),
  incremental: z.literal("1").optional(),
});

export const desktopOperationInput = z.strictObject({
  id: entityId,
  userId: entityId.optional(),
  authoredAt: instant,
  method: z.enum(["POST", "PATCH", "PUT", "DELETE"]),
  path: z.string().max(260).regex(/^\/[a-z0-9\-/]+(?:\?[a-zA-Z0-9_=&]+)?$/),
  body: z.unknown().optional(),
  generatedIds: z.array(entityId).max(2).refine((ids) => new Set(ids).size === ids.length).optional(),
});

type Input = z.infer<typeof desktopOperationInput>;

function validate<T>(value: unknown, schema: z.ZodType<T>) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(422, "VALIDATION_FAILED", "A alteração pendente tem parâmetros inválidos.");
  }
  return result.data;
}

function unsupported(): never {
  throw new ApiError(422, "DESKTOP_OPERATION_UNSUPPORTED", "Esta alteração não está disponível para sincronização.");
}

function splitCreateInput(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { details: body };
  const { id, ...details } = body as Record<string, unknown>;
  return { explicitId: validate(id, entityId.optional()), details };
}

function dispatch(access: ProductAccess, operation: DesktopOperation, input: Input) {
  const [path, queryText] = input.path.split("?");
  const params = [...new URLSearchParams(queryText)];
  if (params.length && input.method !== "DELETE") return unsupported();
  if (new Set(params.map(([key]) => key)).size !== params.length) {
    throw new ApiError(422, "VALIDATION_FAILED", "Informe cada parâmetro da alteração apenas uma vez.");
  }
  const query = Object.fromEntries(params);
  const [, collection, rawId, action, ...rest] = path.split("/");
  if (rest.length || action === "") return unsupported();
  const [first, second] = operation.generatedIds;
  const bind = (task?: DesktopOperation["task"], generatedIds = operation.generatedIds): ProductAccess =>
    ({ ...access, desktopOperation: { ...operation, task, generatedIds } });

  if (path === "/preferences" && input.method === "PATCH") {
    const patch = validate(input.body, preferencesPatch);
    const { db, keys, tenantId } = access;
    return ensureWorkspace(db, keys, tenantId).then(() => persistPreferences(db, keys, tenantId, patch, operation));
  }

  if (rawId === undefined && input.method === "POST") {
    const { explicitId, details } = splitCreateInput(input.body);
    if (explicitId && first && explicitId !== first) {
      throw new ApiError(422, "VALIDATION_FAILED", "O identificador criado é diferente do identificador da fila.");
    }
    const id = explicitId ?? first ?? operation.id;
    switch (collection) {
      case "tasks":
        return createTask(bind({ id, creates: true }, second ? [id, second] : [id]), validate(details, createTaskInput));
      case "projects":
        return createProject(bind(undefined, [id]), validate(details, createProjectInput));
      case "labels":
        return createLabel(bind(undefined, [id]), validate(details, nameInput).name);
      default:
        return unsupported();
    }
  }

  const id = validate(rawId, entityId);
  const verb = `${input.method} ${action ?? ""}`.trimEnd();
  switch (collection) {
    case "tasks": {
      if (params.length && verb !== "DELETE" && verb !== "DELETE recurrence") return unsupported();
      switch (verb) {
        case "PATCH": {
          const args = validate(input.body, editTaskInput);
          if (!args.recurrence) return editTask(bind({ id }), id, args);
          const newOccurrenceId = first ?? operation.id;
          return editTask(bind({ id, newOccurrenceId }, [newOccurrenceId]), id, args);
        }
        case "DELETE": {
          const { revision, withChildren } = validate(query, taskDeleteQuery);
          return deleteTask(bind({ id }), id, revision, withChildren);
        }
        case "POST duplicate": {
          const newId = first ?? operation.id;
          return duplicateTask(bind({ id: newId, creates: true }, second ? [newId, second] : [newId]), id);
        }
        case "POST complete": {
          const args = validate(input.body, completeTaskInput);
          const nextId = first ?? operation.id;
          if (args.occurrenceId === nextId) {
            throw new ApiError(422, "VALIDATION_FAILED", "A próxima ocorrência precisa de um identificador próprio.");
          }
          const task = args.occurrenceId ? { id, newOccurrenceId: nextId } : { id, field: "completion" as const };
          return completeTask(bind(task, [nextId]), id, args);
        }
        case "POST reopen":
          return reopenTask(bind({ id, field: "completion" }), id, validate(input.body, revisionInput).revision);
        case "POST undo-completion": {
          const args = validate(input.body, undoTaskCompletionInput);
          return undoTaskCompletion(bind({ id, ...(args.occurrenceId ? {} : { field: "completion" }) }), id, args);
        }
        case "POST move":
          return moveTask(bind({ id, field: "placement" }), id, validate(input.body, taskMoveInput));
        case "PUT recurrence": {
          const newOccurrenceId = first ?? operation.id;
          return setRecurrence(bind({ id, field: "schedule", newOccurrenceId }, [newOccurrenceId]), id,
            validate(input.body, setRecurrenceInput));
        }
        case "DELETE recurrence":
          return removeRecurrence(bind({ id, field: "schedule" }), id, validate(query, deleteQuery).revision);
        default:
          return unsupported();
      }
    }
    case "projects": {
      if (params.length && verb !== "DELETE") return unsupported();
      switch (verb) {
        case "PATCH": {
          const { revision, ...patch } = validate(input.body, editProjectInput);
          return editProject(bind(), id, revision, patch);
        }
        case "DELETE":
          return deleteProject(bind(), id, validate(query, deleteQuery).revision);
        case "PATCH view":
          return updateProjectView(bind(), id, validate(input.body, projectViewPatch));
        case "POST archive":
        case "POST unarchive":
          return setProjectArchived(bind(), id, validate(input.body, revisionInput).revision, action === "archive");
        case "POST sections": {
          const { beforeSectionId, afterSectionId, ...details } = validate(input.body, createSectionInput);
          return createSection(bind(undefined, [first ?? operation.id]), id, details, { beforeSectionId, afterSectionId });
        }
        case "POST move":
          return moveProject(bind(), id, validate(input.body, projectMoveInput));
        default:
          return unsupported();
      }
    }
    case "sections": {
      if (params.length && verb !== "DELETE") return unsupported();
      switch (verb) {
        case "PATCH": {
          const { revision, ...patch } = validate(input.body, editNamedDetailsInput);
          return editSection(bind(), id, revision, patch);
        }
        case "DELETE":
          return deleteSection(bind(), id, validate(query, deleteQuery).revision);
        case "POST move": {
          const { revision, ...anchor } = validate(input.body, sectionMoveInput);
          return moveSection(bind(), id, revision, anchor);
        }
        default:
          return unsupported();
      }
    }
    case "labels":
      if (params.length && verb !== "DELETE") return unsupported();
      switch (verb) {
        case "PATCH": {
          const { revision, name } = validate(input.body, editNameInput);
          return renameLabel(bind(), id, revision, name);
        }
        case "DELETE":
          return deleteLabel(bind(), id, validate(query, deleteQuery).revision);
        case "POST move":
          return moveLabel(bind(), id, validate(input.body, orderMoveInput));
        default:
          return unsupported();
      }
    default:
      return unsupported();
  }
}

export async function applyDesktopOperation(
  access: ProductAccess, secret: string, input: Input,
): Promise<DesktopWriteResult> {
  const authoredAt = Date.parse(input.authoredAt);
  if (!Number.isFinite(authoredAt) || authoredAt > Date.now() + 5 * 60_000) {
    throw new ApiError(422, "DESKTOP_CLOCK_OUT_OF_RANGE", "A hora da alteração está adiantada. Verifique o relógio do dispositivo.");
  }
  const fingerprint = createHmac("sha256", secret).update(JSON.stringify(["feito-desktop", access.tenantId, input])).digest();
  const operation: DesktopOperation = {
    id: input.id, authoredAt: input.authoredAt, fingerprint, generatedIds: input.generatedIds ?? [],
  };
  try {
    await dispatch(access, operation, input);
    return { outcome: "applied" };
  } catch (error) {
    if (error instanceof DesktopWriteOutcome) return error.result;
    throw error;
  }
}

import { z } from "zod";
import { inboxName, normalizeLabelName } from "../domain/product";
import { maxCommentsPerTask } from "../product/comments";
import { validNominalDate } from "../domain/recurrence";
import { portableDocument, readableSchemaVersions, type ImportIssue, type PortableDocument } from "./document";

const MAX_ERRORS = 50;
const MAX_DEPTH = 10;
const MAX_STRUCTURE = 1_000_000;

// Bound the size of the parsed object before JSON.parse or schema validation.
function withinComplexityLimit(bytes: Uint8Array) {
  let depth = 0;
  let structure = 0;
  let quoted = false;
  let escaped = false;
  for (const byte of bytes) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (byte === 92) escaped = true; // Backslash
      else if (byte === 34) quoted = false;
    } else if (byte === 34) quoted = true;
    else if (byte === 91 || byte === 123) {
      if (++depth > MAX_DEPTH || ++structure > MAX_STRUCTURE) return false;
    } else if (byte === 93 || byte === 125) {
      depth--;
    } else if (byte === 44 && ++structure > MAX_STRUCTURE) {
      return false;
    }
  }
  return true;
}

function validateReferences(document: PortableDocument) {
  const errors: ImportIssue[] = [];
  const identifiers = new Set<string>();
  const positions = new Set<string>();
  function report(path: string, message: string) {
    if (errors.length < MAX_ERRORS) errors.push({ path, message });
  }
  function unique(set: Set<string>, value: string, path: string, message: string) {
    if (set.has(value)) report(path, message);
    else set.add(value);
  }
  function collection<T extends { id: string }>(rows: T[], path: string) {
    const map = new Map<string, T>();
    for (const [index, row] of rows.entries()) {
      unique(identifiers, row.id, `${path}.${index}.id`, "Identificador duplicado no documento.");
      map.set(row.id, row);
    }
    return map;
  }
  const projects = collection(document.projects, "projects");
  const sections = collection(document.sections, "sections");
  const tasks = collection(document.tasks, "tasks");
  const labels = collection(document.labels, "labels");

  const inboxes = document.projects.filter((project) => project.isInbox);
  if (inboxes.length !== 1) report("projects", "O documento deve conter exatamente uma Entrada.");
  else {
    const [inbox] = inboxes;
    if (inbox.archived || inbox.view.layout === "board" || inbox.name !== inboxName) {
      report("projects", "A Entrada deve estar ativa, com nome fixo e sem layout Painel.");
    }
    if (inbox.defaultSectionName) report("projects", "A Entrada não pode ter seção.");
  }
  for (const [index, project] of document.projects.entries()) {
    if (project.parentId === undefined) continue;
    const parent = projects.get(project.parentId);
    if (!parent || parent.isInbox || parent.id === project.id) {
      report(`projects.${index}.parentId`, "O projeto principal precisa ser outro projeto comum do documento.");
    }
  }
  for (const [index, section] of document.sections.entries()) {
    const path = `sections.${index}`;
    const project = projects.get(section.projectId);
    if (!project || project.isInbox) report(`${path}.projectId`, "A seção precisa pertencer a um projeto comum.");
    unique(positions, JSON.stringify(["section", section.projectId, section.position]),
      `${path}.position`, "Posição duplicada no projeto.");
  }
  for (const [index, task] of document.tasks.entries()) {
    const path = `tasks.${index}`;
    if (!projects.has(task.projectId)) report(`${path}.projectId`, "Projeto ausente do documento.");
    if (task.sectionId !== null && sections.get(task.sectionId)?.projectId !== task.projectId) {
      report(`${path}.sectionId`, "A seção precisa pertencer ao projeto da tarefa.");
    }
    if (task.parentId !== null) {
      const parent = tasks.get(task.parentId);
      if (!parent || parent.projectId !== task.projectId
        || parent.sectionId !== task.sectionId || parent.recurrenceRule !== null) {
        report(`${path}.parentId`, "A tarefa pai deve estar no mesmo projeto e seção e não ter recorrência.");
      } else if (parent.status === "completed" && task.status === "active") {
        report(`${path}.status`, "Uma tarefa concluída não pode ter uma subtarefa ativa.");
      }
    }
    if ((task.status === "completed") !== (task.completedAt !== null)) {
      report(`${path}.completedAt`, "O instante de conclusão precisa corresponder ao estado.");
    }
    if (task.dueTime !== null && task.dueDate === null) {
      report(`${path}.dueTime`, "O horário exige uma data.");
    }
    if ((task.occurrenceId === null) !== (task.recurrenceRule === null)) {
      report(`${path}.occurrenceId`, "A regra exige o identificador da ocorrência atual.");
    }
    if (task.recurrenceRule && (task.parentId !== null || task.status !== "active"
      || task.dueDate === null || !validNominalDate(task.recurrenceRule))) {
      report(`${path}.recurrenceRule`, "A ocorrência precisa ter data nominal válida e pertencer a uma raiz ativa.");
    }
    if (task.occurrenceId !== null) {
      unique(identifiers, task.occurrenceId, `${path}.occurrenceId`, "Identificador de ocorrência duplicado.");
    }
    unique(positions, JSON.stringify(["task", task.projectId, task.sectionId, task.parentId, task.position]),
      `${path}.position`, "Posição duplicada no grupo de tarefas.");
  }
  const checked = new Set<string>();
  for (const [index, task] of document.tasks.entries()) {
    if (checked.has(task.id)) continue;
    const ancestors = new Set<string>();
    let current: typeof task | undefined = task;
    while (current && !checked.has(current.id)) {
      if (ancestors.has(current.id)) {
        report(`tasks.${index}.parentId`, "A hierarquia de tarefas contém um ciclo.");
        break;
      }
      ancestors.add(current.id);
      current = current.parentId ? tasks.get(current.parentId) : undefined;
    }
    for (const id of ancestors) checked.add(id);
  }
  const labelNames = new Set<string>();
  for (const [index, label] of document.labels.entries()) {
    unique(labelNames, normalizeLabelName(label.name), `labels.${index}.name`, "Nome de etiqueta duplicado.");
  }
  const links = new Set<string>();
  for (const [index, link] of document.taskLabels.entries()) {
    const path = `taskLabels.${index}`;
    if (!tasks.has(link.taskId)) report(`${path}.taskId`, "Tarefa ausente do documento.");
    if (!labels.has(link.labelId)) report(`${path}.labelId`, "Etiqueta ausente do documento.");
    unique(links, JSON.stringify([link.taskId, link.labelId]), path, "Vínculo duplicado.");
  }
  for (const [index, occurrence] of document.occurrences.entries()) {
    const path = `occurrences.${index}`;
    if (!tasks.has(occurrence.taskId)) report(`${path}.taskId`, "Tarefa ausente do documento.");
    unique(identifiers, occurrence.occurrenceId, `${path}.occurrenceId`, "Identificador de ocorrência duplicado.");
  }
  const commentCounts = new Map<string, number>();
  for (const [index, comment] of (document.comments ?? []).entries()) {
    const path = `comments.${index}`;
    if (!tasks.has(comment.taskId)) report(`${path}.taskId`, "Tarefa ausente do documento.");
    const count = (commentCounts.get(comment.taskId) ?? 0) + 1;
    commentCounts.set(comment.taskId, count);
    if (count === maxCommentsPerTask + 1) report(path, "A tarefa excede o limite de comentários.");
  }
  return errors;
}

const collectionLimits = {
  projects: 10_000, sections: 20_000, tasks: 30_000, labels: 20_000, taskLabels: 100_000, occurrences: 50_000,
  comments: 100_000,
} as const;
const envelope = portableDocument.extend({
  projects: z.array(z.unknown()).max(collectionLimits.projects),
  sections: z.array(z.unknown()).max(collectionLimits.sections),
  tasks: z.array(z.unknown()).max(collectionLimits.tasks),
  labels: z.array(z.unknown()).max(collectionLimits.labels),
  taskLabels: z.array(z.unknown()).max(collectionLimits.taskLabels),
  occurrences: z.array(z.unknown()).max(collectionLimits.occurrences),
  comments: z.array(z.unknown()).max(collectionLimits.comments).optional(),
});

function validationIssues(error: z.ZodError, path?: string): ImportIssue[] {
  return error.issues.slice(0, MAX_ERRORS).map((issue) => ({
    path: (path ? [path, ...issue.path] : issue.path).join("."),
    message: issue.code === "too_big" && issue.origin === "array"
      ? "A coleção excede o limite de registros."
      : "Campo fora do formato esperado.",
  }));
}

function parseRows<T>(rows: unknown[], schema: z.ZodType<T>, path: string, errors: ImportIssue[]): T[] {
  const values: T[] = [];
  for (let index = 0; index < rows.length && errors.length < MAX_ERRORS; index++) {
    const parsed = schema.safeParse(rows[index]);
    if (parsed.success) values.push(parsed.data);
    else errors.push(...validationIssues(parsed.error, `${path}.${index}`).slice(0, MAX_ERRORS - errors.length));
  }
  return values;
}

type ParsedDocument =
  | { schemaVersion: number; document: PortableDocument; errors: [] }
  | { schemaVersion: number | null; document: null; errors: ImportIssue[] };

export function parseDocument(bytes: Uint8Array): ParsedDocument {
  if (!withinComplexityLimit(bytes)) {
    return { schemaVersion: null, document: null, errors: [{ path: "", message: "Documento complexo demais." }] };
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { schemaVersion: null, document: null, errors: [{ path: "", message: "Use um arquivo JSON válido em UTF-8." }] };
  }
  const version = value !== null && typeof value === "object" && "schemaVersion" in value
    && typeof value.schemaVersion === "number" && Number.isSafeInteger(value.schemaVersion) ? value.schemaVersion : null;
  if (version !== null && !readableSchemaVersions.includes(version)) {
    return { schemaVersion: version, document: null,
      errors: [{ path: "schemaVersion", message: "Versão de documento incompatível." }] };
  }
  const parsed = envelope.safeParse(value);
  if (!parsed.success) return { schemaVersion: version, document: null, errors: validationIssues(parsed.error) };
  const header = parsed.data;
  if ((header.comments === undefined) !== (header.schemaVersion === 1)) {
    return { schemaVersion: version, document: null, errors: [{ path: "comments", message: "Campo fora do formato esperado." }] };
  }
  const errors: ImportIssue[] = [];
  const { comments, ...rest } = header;
  const document: PortableDocument = {
    ...rest,
    projects: parseRows(header.projects, portableDocument.shape.projects.element, "projects", errors),
    sections: parseRows(header.sections, portableDocument.shape.sections.element, "sections", errors),
    tasks: parseRows(header.tasks, portableDocument.shape.tasks.element, "tasks", errors),
    labels: parseRows(header.labels, portableDocument.shape.labels.element, "labels", errors),
    taskLabels: parseRows(header.taskLabels, portableDocument.shape.taskLabels.element, "taskLabels", errors),
    occurrences: parseRows(header.occurrences, portableDocument.shape.occurrences.element, "occurrences", errors),
    ...comments && {
      comments: parseRows(comments, portableDocument.shape.comments.unwrap().element, "comments", errors),
    },
  };
  const issues = errors.length ? errors : validateReferences(document);
  return issues.length
    ? { schemaVersion: header.schemaVersion, document: null, errors: issues }
    : { schemaVersion: header.schemaVersion, document, errors: [] };
}

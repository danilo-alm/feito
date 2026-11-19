import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { findImportSource, type ImportSourceId } from "@/domain/import-sources";
import { groupTasks, normalizeLabelName, orderedSections, type Product, type Project, type Task } from "@/domain/product";
import { findReceipt, replay } from "@/server/db/portability";
import { mutateProduct, readProduct, type ProductAccess } from "@/server/db/product";
import { notFound } from "@/server/errors";
import { importers } from "@/server/importers";
import { projectTasks, walkTasks, type ImportPlan, type ImporterResult, type PlannedTask } from "@/server/importers/plan";
import {
  checkPreviewToken, fileDigest, invalidImport, makePreviewToken, receiptFingerprint,
} from "@/server/portability/token";
import { importOperations } from "@/server/db/schema";
import type { ImportCounts } from "@/validation/portability";
import { defaultsForView, entityId } from "@/validation/product";
import { visibleRecord, writableProject } from "./product-rules";

// Importação aditiva a partir de outros apps: cria projetos novos, ou acrescenta tarefas e seções
// ao fim de um projeto existente (`projectId`), sem alterar o que já existe.

const MAX_FILES = 100;
const body = z.strictObject({
  files: z.array(z.strictObject({ name: z.string().max(255), content: z.string() })).min(1).max(MAX_FILES),
  projectId: entityId.optional(),
});

export function sourceFor(id: string): ImportSourceId {
  const source = findImportSource(id);
  if (!source) throw notFound();
  return source.id;
}

function readFiles(file: Uint8Array) {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file));
  } catch {
    throw invalidImport([{ path: "", message: "Envie os arquivos em JSON UTF-8." }]);
  }
  const parsed = body.safeParse(value);
  if (!parsed.success) throw invalidImport([{ path: "files", message: `Envie de 1 a ${MAX_FILES} arquivos.` }]);
  return parsed.data;
}

/** Junta todos os arquivos num único projeto de destino. A Caixa de entrada não tem seções. */
function mergeInto(target: Project, plan: ImportPlan, warnings: string[]): ImportPlan {
  const tasks = plan.projects.flatMap((project) => project.tasks);
  let sections = plan.projects.flatMap((project) => project.sections);
  if (target.isInbox && sections.length) {
    tasks.push(...sections.flatMap((section) => section.tasks));
    warnings.push(`${sections.length === 1 ? "1 seção foi desfeita" : `${sections.length} seções foram desfeitas`}: a Caixa de entrada não tem seções, então as tarefas ficam soltas.`);
    sections = [];
  }
  return { projects: [{ name: target.data.name, layout: target.data.view.layout, tasks, sections }] };
}

function run(product: Product, source: ImportSourceId, file: Uint8Array): ImporterResult & { target: Project | null } {
  const { files, projectId } = readFiles(file);
  const target = projectId ? writableProject(visibleRecord(product.projects, projectId)) : null;
  const result = importers[source](files, { referenceDate: product.referenceDate });
  if (!target || !result.plan) return { ...result, target };
  const warnings = [...result.warnings];
  return { ...result, plan: mergeInto(target, result.plan, warnings), warnings, target };
}

/** Etiquetas do plano que ainda não existem na conta, pelo nome normalizado. */
function newLabels(product: Product, plan: ImportPlan) {
  const existing = new Set([...product.labels.values()].map((label) => normalizeLabelName(label.data.name)));
  const created = new Map<string, string>();
  for (const project of plan.projects) {
    walkTasks(projectTasks(project), (task) => {
      for (const name of task.labels) {
        const key = normalizeLabelName(name);
        if (!existing.has(key) && !created.has(key)) created.set(key, name);
      }
    });
  }
  return created;
}

function countsFor(plan: ImportPlan, labels: number, target: Project | null): ImportCounts {
  let tasks = 0;
  for (const project of plan.projects) walkTasks(projectTasks(project), () => { tasks += 1; });
  return {
    projects: target ? 0 : plan.projects.length, archivedProjects: 0,
    sections: plan.projects.reduce((sum, project) => sum + project.sections.length, 0),
    tasks, completedTasks: 0, labels, occurrences: 0,
  };
}

function projectPreview(plan: ImportPlan) {
  return plan.projects.map((project) => {
    let tasks = 0;
    let subtasks = 0;
    let dated = 0;
    let recurring = 0;
    walkTasks(projectTasks(project), (task, depth) => {
      if (depth) subtasks += 1;
      else tasks += 1;
      if (task.dueDate) dated += 1;
      if (task.recurrence) recurring += 1;
    });
    return { name: project.name, layout: project.layout, sections: project.sections.length, tasks, subtasks, dated, recurring };
  });
}

const binding = (access: ProductAccess, sessionId: string, operationId: string, source: ImportSourceId, file: Uint8Array) => ({
  sessionId, operationId, tenantId: access.tenantId,
  digest: fileDigest(Buffer.concat([Buffer.from(`feito:import:${source}\0`), file])),
});

export async function previewSourceImport(
  access: ProductAccess, sessionId: string, source: ImportSourceId, operationId: string, secret: string, file: Uint8Array,
) {
  const product = await readProduct(access, (snapshot) => snapshot);
  const result = run(product, source, file);
  const token = result.plan
    ? makePreviewToken(secret, binding(access, sessionId, operationId, source, file))
    : { previewToken: null, expiresAt: null };
  return {
    source,
    target: result.target && { id: result.target.id, name: result.target.data.name },
    counts: result.plan ? countsFor(result.plan, newLabels(product, result.plan).size, result.target) : null,
    projects: result.plan ? projectPreview(result.plan) : [],
    warnings: result.warnings,
    errors: result.errors,
    referenceDate: product.referenceDate,
    ...token,
  };
}

function insertTasks(
  product: Product, labelIds: Map<string, string>, planned: PlannedTask[],
  group: { projectId: string; sectionId: string | null; parentId: string | null }, start = 0,
) {
  const pending = [{ siblings: planned.entries(), group, start }];
  while (pending.length) {
    const frame = pending.at(-1)!;
    const next = frame.siblings.next();
    if (next.done) {
      pending.pop();
      continue;
    }
    const [index, item] = next.value;
    const position = frame.start + index;
    const id = randomUUID();
    const recurrenceRule = item.recurrence
      ? { ...item.recurrence, nominalDate: item.recurrence.anchorDate, time: item.dueTime }
      : null;
    const task: Task = {
      ...frame.group, id, revision: 1, occurrenceId: recurrenceRule ? randomUUID() : null,
      data: {
        title: item.title, description: item.description, priority: item.priority,
        createdAt: product.now.toString(), completedAt: null, position,
        dueDate: recurrenceRule ? recurrenceRule.anchorDate : item.dueDate,
        dueTime: item.dueDate || recurrenceRule ? item.dueTime : null,
        recurrenceRule,
      },
    };
    product.tasks.set(id, task);
    const links = [...new Set(item.labels.map((name) => labelIds.get(normalizeLabelName(name))!))];
    if (links.length) product.taskLabels.set(id, links);
    if (item.children.length) {
      pending.push({ siblings: item.children.entries(), group: { ...frame.group, parentId: id }, start: 0 });
    }
  }
}

function applyPlan(product: Product, plan: ImportPlan, target: Project | null) {
  const labelIds = new Map([...product.labels.values()].map((label) => [normalizeLabelName(label.data.name), label.id]));
  for (const [key, name] of newLabels(product, plan)) {
    const id = randomUUID();
    product.labels.set(id, { id, revision: 1, data: { name } });
    labelIds.set(key, id);
  }
  if (target) {
    const [project] = plan.projects;
    const roots = { projectId: target.id, sectionId: null, parentId: null };
    insertTasks(product, labelIds, project.tasks, roots, (groupTasks(product, roots).at(-1)?.data.position ?? -1) + 1);
    const first = (orderedSections(product, target.id).at(-1)?.data.position ?? -1) + 1;
    for (const [index, section] of project.sections.entries()) {
      const sectionId = randomUUID();
      product.sections.set(sectionId, { id: sectionId, projectId: target.id, revision: 1, data: { name: section.name, description: "", position: first + index } });
      insertTasks(product, labelIds, section.tasks, { ...roots, sectionId });
    }
    return [target.id];
  }
  const projectIds: string[] = [];
  for (const [index, project] of plan.projects.entries()) {
    const id = randomUUID();
    // Projetos são ordenados pela criação: um milissegundo de diferença preserva a ordem dos arquivos.
    const createdAt = product.now.add({ milliseconds: index }).toString();
    product.projects.set(id, {
      id, revision: 1, isInbox: false,
      data: { name: project.name, description: "", color: null, icon: "hash", archived: false, createdAt, view: { ...defaultsForView, layout: project.layout } },
    });
    projectIds.push(id);
    insertTasks(product, labelIds, project.tasks, { projectId: id, sectionId: null, parentId: null });
    for (const [position, section] of project.sections.entries()) {
      const sectionId = randomUUID();
      product.sections.set(sectionId, { id: sectionId, projectId: id, revision: 1, data: { name: section.name, description: "", position } });
      insertTasks(product, labelIds, section.tasks, { projectId: id, sectionId, parentId: null });
    }
  }
  return projectIds;
}

class AlreadyImported extends Error {
  constructor(readonly receipt: NonNullable<Awaited<ReturnType<typeof findReceipt>>>) {
    super("Importação já registrada.");
  }
}

export async function confirmSourceImport(
  access: ProductAccess, sessionId: string, source: ImportSourceId, operationId: string,
  token: string, secret: string, file: Uint8Array,
) {
  const bound = binding(access, sessionId, operationId, source, file);
  checkPreviewToken(token, secret, bound);
  const fingerprint = receiptFingerprint(secret, bound);
  let summary: ImportCounts | null = null;
  try {
    return await mutateProduct(access, (product) => {
      const result = run(product, source, file);
      if (!result.plan) throw invalidImport(result.errors);
      summary = countsFor(result.plan, newLabels(product, result.plan).size, result.target);
      return { operationId, summary, projectIds: applyPlan(product, result.plan, result.target) };
    }, undefined, {
      // Recibo e dados entram no mesmo commit; repetir a operação devolve o mesmo resumo.
      async record(tx) {
        const receipt = await findReceipt(tx, operationId);
        if (receipt) throw new AlreadyImported(receipt);
        await tx.insert(importOperations).values({ tenantId: access.tenantId, operationId, fingerprint, summary: summary! });
      },
    });
  } catch (error) {
    if (error instanceof AlreadyImported) return replay(error.receipt, fingerprint);
    throw error;
  }
}

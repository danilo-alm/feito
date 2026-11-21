import { projectExport, exportRequest } from "@feito/core/portability/project-export";
import { countsFor } from "@feito/core/portability/document";
import { exportLocalWorkspace, localDestinationIsEmpty, restoreLocalWorkspace } from "@feito/core/portability/local";
import {
  applySourcePlan, invalidImport, newLabels, planSourceImport, projectPreview, readFiles, sourceCounts, sourceFor,
} from "@feito/core/portability/source-import";
import { parseDocument } from "@feito/core/portability/validate";
import { ApiError, notFound } from "@feito/core/product/errors";
import { asProduct, mutateProduct } from "@feito/core/product/local-workspace";
import { entityId } from "@feito/core/validation/product";
import type { ImportPreview, SourceImportPreview, SourceImportResult } from "@feito/core/types";
import { accountReplica, localSpace, type BrowserRecord, type BrowserUpdate } from "./storage";

const maxFile = 32 * 1024 * 1024;
const tokenLifetime = 20 * 60_000;
const projectFile = /^\/projects\/([^/]+)\/export$/;
const sourcePath = /^\/import\/sources\/([^/]+)\/(preview|confirm)$/;
const operationPath = /^\/import\/operations\/([^/]+)$/;

export type Preview = { binding: string; token: string; expires: number };
type Portability = {
  method: string;
  path: string;
  init: RequestInit;
  record: BrowserRecord;
  previews: Map<string, Preview>;
  read: () => Promise<BrowserRecord>;
  commit: <T>(run: (current: BrowserRecord) => Promise<{ value: T; update?: BrowserUpdate }>) => Promise<T>;
};

export function isLocalPortability(path: string, local: boolean) {
  return path === "/export" || projectFile.test(path) || (local && path.startsWith("/import/"));
}

function attachment(fileName: string) {
  return { "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(fileName) };
}

export async function localPortability({ method, path, init, record, previews, read, commit }: Portability) {
  const url = new URL(path, "https://feito.invalid");
  const local = localSpace(record);
  const workspace = local?.workspace ?? accountReplica(record)?.working;
  if (!workspace) throw notFound();
  const project = projectFile.exec(url.pathname);
  if (method === "GET" && project) {
    const file = projectExport(asProduct(workspace), project[1], exportRequest(url.searchParams));
    return new Response(file.body, { headers: { "Content-Type": file.contentType, ...attachment(file.fileName) } });
  }
  if (method === "GET" && url.pathname === "/export") {
    const { document, referenceDate } = exportLocalWorkspace(workspace);
    return Response.json(document, { headers: attachment(`feito-dados-${referenceDate}.json`) });
  }
  if (!local) throw notFound();
  const operation = operationPath.exec(url.pathname);
  if (method === "GET" && operation) {
    const receipt = local.imports?.[operation[1]];
    if (!receipt) throw notFound();
    return Response.json({ ...receipt.result, status: "completed" });
  }

  const sourceParts = sourcePath.exec(url.pathname);
  const source = sourceParts ? sourceFor(sourceParts[1]) : undefined;
  const action = sourceParts?.[2] ?? url.pathname.split("/").at(-1);
  if (method !== "POST" || (action !== "preview" && action !== "confirm")) throw notFound();
  const headers = new Headers(init.headers);
  const operationId = entityId.safeParse(headers.get("X-Operation-Id"));
  if (!operationId.success || !(init.body instanceof Blob) || init.body.size > maxFile) {
    throw invalidImport([{ path: "", message: "Escolha um arquivo de até 32 MB para importar." }]);
  }
  const id = operationId.data;
  const bytes = await init.body.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const binding = (source ?? "backup") + ":" + Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const backup = source ? undefined : parseDocument(new Uint8Array(bytes));
  const files = source && readFiles(new Uint8Array(bytes));
  await read();

  if (action === "preview") {
    const product = asProduct(workspace);
    const result = source && files ? planSourceImport(product, source, files) : undefined;
    const possible = !!(backup?.document || result?.plan);
    const expires = Date.now() + tokenLifetime;
    const token = possible ? crypto.randomUUID() : null;
    for (const [key, preview] of previews) {
      if (preview.expires <= Date.now() || previews.size >= 20) previews.delete(key);
    }
    if (token) previews.set(id, { binding, token, expires });
    const metadata = { previewToken: token, expiresAt: token ? new Date(expires).toISOString() : null };
    if (source && result) {
      return Response.json({
        ...metadata, source, target: result.target && { id: result.target.id, name: result.target.data.name },
        counts: result.plan ? sourceCounts(result.plan, newLabels(product, result.plan).size, result.target) : null,
        projects: result.plan ? projectPreview(result.plan) : [],
        warnings: result.warnings, errors: result.errors, referenceDate: product.referenceDate,
      } satisfies SourceImportPreview);
    }
    return Response.json({
      ...metadata,
      schemaVersion: backup?.schemaVersion ?? null,
      counts: backup?.document ? countsFor(backup.document) : null,
      errors: backup?.errors ?? [],
      destinationEmpty: localDestinationIsEmpty(workspace),
    } satisfies ImportPreview);
  }

  const result = await commit<SourceImportResult>(async (current) => {
    const destination = localSpace(current);
    if (!destination) throw notFound();
    const receipt = destination.imports?.[id];
    if (receipt) {
      if (receipt.binding !== binding) throw new ApiError(409, "IMPORT_OPERATION_CONFLICT", "A operação já foi usada para outro arquivo.");
      return { value: receipt.result };
    }
    const preview = previews.get(id);
    if (!preview || preview.token !== headers.get("X-Preview-Token") || preview.expires <= Date.now() || preview.binding !== binding) {
      throw new ApiError(410, "PREVIEW_EXPIRED", "Escolha o arquivo de novo para gerar uma prévia.");
    }
    let workspace = destination.workspace;
    let value: SourceImportResult;
    if (source && files) {
      const randomUUID = () => crypto.randomUUID();
      const access = { workspace, allocateId: randomUUID, revision: current.generation + 1 };
      value = await mutateProduct(access, (product) => {
        const result = planSourceImport(product, source, files);
        if (!result.plan) throw invalidImport(result.errors);
        const summary = sourceCounts(result.plan, newLabels(product, result.plan).size, result.target);
        return { operationId: id, summary, projectIds: applySourcePlan(product, result.plan, result.target, randomUUID) };
      });
      workspace = access.workspace;
    } else {
      if (!backup?.document) throw invalidImport(backup?.errors ?? []);
      workspace = restoreLocalWorkspace(workspace, backup.document);
      value = { operationId: id, summary: countsFor(backup.document) };
    }
    const saved = { operationId: id, summary: value.summary };
    return {
      value, update: {
        data: { workspace, imports: { ...destination.imports, [id]: { binding, result: saved } } },
      },
    };
  });
  previews.delete(id);
  await read();
  return Response.json(result);
}

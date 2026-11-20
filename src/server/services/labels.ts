import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeLabelName, type Product } from "@/domain/product";
import { mutateProduct, type ProductAccess } from "@/server/db/product";
import { ApiError } from "@/server/errors";
import { readProductSummary } from "@/server/db/product-summary";
import { readTaskView } from "@/server/db/task-views";
import { labelDto, labelSummaries, taskItemsWithOrigin } from "./product-dto";
import { nextRevision, requireRevision, validation, visibleRecord } from "./product-rules";

export function listLabels(access: ProductAccess) {
  return readProductSummary(access, "labels", (summary) => ({
    labels: labelSummaries(summary.labels.values(), summary.labelCounts),
  }));
}

function uniqueName(product: Product, name: string, currentId?: string) {
  const normalized = normalizeLabelName(name);
  const existing = [...product.labels.values()].find((label) =>
    label.id !== currentId && normalizeLabelName(label.data.name) === normalized,
  );
  if (existing) throw new ApiError(409, "LABEL_EXISTS", "Já existe uma etiqueta com esse nome.", { id: existing.id });
}

export function createLabel(access: ProductAccess, name: string) {
  const id = access.desktopOperation?.generatedIds[0] ?? randomUUID();
  return mutateProduct(access, (product) => {
    if (product.labels.has(id)) throw new ApiError(409, "DESKTOP_ID_UNAVAILABLE", "O identificador já foi usado.");
    uniqueName(product, name);
    const label = { id, revision: 1, data: { name } };
    product.labels.set(id, label);
    return labelDto(product, label);
  });
}

export function renameLabel(access: ProductAccess, id: string, revision: number, name: string) {
  return mutateProduct(access, (product, original) => {
    const label = visibleRecord(product.labels, id);
    requireRevision(label, revision, () => labelDto(product, label));
    uniqueName(product, name, id);
    const updated = nextRevision(original.labels, { ...label, data: { name } });
    product.labels.set(id, updated);
    return labelDto(product, updated);
  });
}

export function deleteLabel(access: ProductAccess, id: string, revision: number) {
  return mutateProduct(access, (product) => {
    const label = visibleRecord(product.labels, id);
    requireRevision(label, revision, () => labelDto(product, label));
    for (const [taskId, ids] of product.taskLabels) {
      if (!ids.includes(id)) continue;
      const remaining = ids.filter((value) => value !== id);
      if (remaining.length) product.taskLabels.set(taskId, remaining);
      else product.taskLabels.delete(taskId);
    }
    product.labels.delete(id);
  });
}

const cursorPayload = z.tuple([z.literal(1), z.uuid(), z.uuid()]);

function encodeCursor(labelId: string, taskId: string) {
  return Buffer.from(JSON.stringify([1, labelId, taskId])).toString("base64url");
}

function decodeCursor(value: string, labelId: string) {
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") === value) {
      const cursor = cursorPayload.safeParse(JSON.parse(decoded.toString("utf8")));
      if (cursor.success && cursor.data[1] === labelId) return cursor.data[2];
    }
  } catch {
    // Report one validation error for malformed cursors and cursors from another label.
  }
  throw validation("cursor", "A página solicitada é inválida.");
}

export function listLabelTasks(access: ProductAccess, id: string, limit: number, cursor?: string) {
  return readTaskView(access, {
    operation: "label",
    labelId: id,
    page: { after: () => cursor ? decodeCursor(cursor, id) : undefined, limit: limit + 1 },
  }, async (view) => {
    const candidates = [...view.candidates.values()];
    const page = candidates.slice(0, limit);
    const product = await view.contextFor(page);
    return {
      referenceDate: view.referenceDate,
      tasks: page.map(taskItemsWithOrigin(product)),
      nextCursor: candidates.length > limit ? encodeCursor(id, page.at(-1)!.id) : null,
    };
  });
}

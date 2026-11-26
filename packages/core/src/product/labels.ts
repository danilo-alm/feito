import { z } from "zod";
import { compareLabels, normalizeLabelName, type Product } from "../domain/product";
import { ApiError } from "./errors";
import { labelDto, labelSummaries, taskItemsWithOrigin } from "./product-dto";
import { nextRevision, placeInOrder, requireRevision, validation, visibleRecord } from "./product-rules";
import type { OrderAnchor } from "../types";
import type { ProductPort } from "./port";

export function createLabelsService<Access>({ allocateId, mutateProduct, readProductSummary, readTaskView }: Pick<ProductPort<Access>, "allocateId" | "mutateProduct" | "readProductSummary" | "readTaskView">) {
  function listLabels(access: Access) {
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

  function createLabel(access: Access, name: string) {
    const id = allocateId(access, 0);
    return mutateProduct(access, (product) => {
      if (product.labels.has(id)) throw new ApiError(409, "DESKTOP_ID_UNAVAILABLE", "O identificador já foi usado.");
      uniqueName(product, name);
      const label = { id, revision: 1, data: { name } };
      product.labels.set(id, label);
      return labelDto(product, label);
    });
  }

  function renameLabel(access: Access, id: string, revision: number, name: string) {
    return mutateProduct(access, (product, original) => {
      const label = visibleRecord(product.labels, id);
      requireRevision(label, revision, () => labelDto(product, label));
      uniqueName(product, name, id);
      const updated = nextRevision(original.labels, { ...label, data: { ...label.data, name } });
      product.labels.set(id, updated);
      return labelDto(product, updated);
    });
  }

  function moveLabel(access: Access, id: string, anchor: OrderAnchor) {
    return mutateProduct(access, (product, original) => {
      const label = visibleRecord(product.labels, id);
      const labelIds = placeInOrder([...product.labels.values()].sort(compareLabels), label, anchor, original.labels,
        (record) => product.labels.set(record.id, record));
      return { labelIds };
    });
  }

  function deleteLabel(access: Access, id: string, revision: number) {
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

  function listLabelTasks(access: Access, id: string, limit: number, cursor?: string) {
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

  return {
    listLabels, createLabel, renameLabel, moveLabel, deleteLabel, listLabelTasks,
  };
}

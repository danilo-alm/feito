import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { compareSearchKey, matchesSearch, normalizeSearchText, searchKey } from "@/domain/search";
import type { ProductAccess } from "@/server/db/product";
import { readTaskView } from "@/server/db/task-views";
import type { SearchInput } from "@/validation/product";
import { taskItemsWithOrigin } from "./product-dto";
import { validation } from "./product-rules";

const payload = z.tuple([z.literal(1), z.boolean(), z.uuid()]);
type SearchKey = ReturnType<typeof searchKey>;

function cursorSignature(secret: string, criteria: string, encoded: string) {
  return createHmac("sha256", secret).update(JSON.stringify(["feito:search:cursor", criteria, encoded])).digest();
}

function encodeCursor(key: SearchKey, secret: string, criteria: string) {
  const encoded = Buffer.from(JSON.stringify([1, key.completed, key.id])).toString("base64url");
  const signature = cursorSignature(secret, criteria, encoded).toString("base64url");
  return `${encoded}.${signature}`;
}

function decodeCursor(cursor: string, secret: string, criteria: string): SearchKey {
  const [encoded, signature, extra] = cursor.split(".");
  if (encoded && signature && extra === undefined) {
    const bytes = Buffer.from(signature, "base64url");
    const expected = cursorSignature(secret, criteria, encoded);
    if (bytes.length === expected.length && bytes.toString("base64url") === signature
      && timingSafeEqual(bytes, expected)) {
      try {
        const decoded = payload.safeParse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
        if (decoded.success) return { completed: decoded.data[1], id: decoded.data[2] };
      } catch {
        // Reject malformed cursor payloads with the same validation error.
      }
    }
  }
  throw validation("cursor", "O cursor não corresponde à busca atual.");
}

export function searchTasks(access: ProductAccess, secret: string, input: SearchInput) {
  const text = normalizeSearchText(input.text ?? "");
  const { projectId, labelId, priority, date, includeCompleted, cursor, limit } = input;
  const hasCriteria = !!(text || projectId || labelId || priority !== undefined || date);
  const scope = { projectId, labelId, operation: "search" as const, skipTasks: !hasCriteria };

  return readTaskView(access, scope, async (view) => {
    const referenceDate = view.referenceDate;
    if (!hasCriteria) return { referenceDate, results: [], nextCursor: null };

    const relativeDate = date?.kind === "today" || date?.kind === "overdue";
    const dateFilter = date?.kind === "range" ? [date.kind, date.from, date.to] : date?.kind;
    const criteria = JSON.stringify([
      access.tenantId, projectId, labelId, priority, dateFilter, includeCompleted, text, relativeDate ? referenceDate : null,
    ]);
    const after = cursor ? decodeCursor(cursor, secret, criteria) : undefined;
    const matches = [...view.candidates.values()]
      .filter((task) => matchesSearch(task, input, text, referenceDate))
      .map((task) => ({ task, key: searchKey(task) }))
      .sort((a, b) => compareSearchKey(a.key, b.key));
    const start = after ? matches.findIndex(({ key }) => compareSearchKey(key, after) > 0) : 0;
    const page = start < 0 ? [] : matches.slice(start, start + limit);
    const results = page.map(({ task }) => task);
    const product = await view.contextFor(results);
    return {
      referenceDate,
      results: results.map(taskItemsWithOrigin(product)),
      nextCursor: page.length && start + page.length < matches.length
        ? encodeCursor(page.at(-1)!.key, secret, criteria)
        : null,
    };
  });
}

import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defaultPreferences } from "@/domain/preferences";
import { documentType, type PortableDocument } from "@/server/portability/document";
import { checkPreviewToken, fileDigest, makePreviewToken } from "@/server/portability/token";
import { parseDocument } from "@/server/portability/validate";
import { defaultsForView } from "@/validation/product";

function emptyDocument() {
  return {
    type: documentType,
    schemaVersion: 1,
    exportedAt: "2026-11-17T12:00:00Z",
    preferences: defaultPreferences,
    projects: [{ id: "inbox", isInbox: true, name: "Caixa de entrada", archived: false,
      view: defaultsForView, createdAt: "1970-01-01T00:00:00Z" }],
    sections: [], tasks: [], labels: [], taskLabels: [], occurrences: [],
  } satisfies PortableDocument;
}

const parse = (value: unknown) => parseDocument(Buffer.from(JSON.stringify(value)));

describe("portable document", () => {
  it("accepts v1 and reports an unknown version by path", () => {
    const file = emptyDocument();
    expect(parse(file)).toEqual({ schemaVersion: 1, document: file, errors: [] });
    expect(parse({ ...file, schemaVersion: 2 })).toMatchObject({
      schemaVersion: 2, document: null, errors: [{ path: "schemaVersion" }],
    });
    expect(parse({ ...file, tenantId: randomUUID() }).document).toBeNull();
  });

  it("rejects duplicate IDs and labels, broken links, and sections in Inbox", () => {
    const doc = emptyDocument();
    const invalid = {
      ...doc,
      sections: [{ id: "inbox", projectId: "inbox", name: "Seção", position: 0 }],
      labels: [{ id: "label1", name: "Café" }, { id: "label2", name: "CAFE\u0301" }],
      taskLabels: [{ taskId: "missing", labelId: "label1" }],
    };
    const result = parse(invalid);
    expect(result.document).toBeNull();
    expect(result.errors.map(({ path }) => path)).toEqual(expect.arrayContaining([
      "sections.0.id", "sections.0.projectId", "labels.1.name", "taskLabels.0.taskId",
    ]));
  });

  it("limits nesting and reported errors before validating relationships", () => {
    expect(parseDocument(Buffer.from("[".repeat(11) + "0" + "]".repeat(11))).errors[0].message)
      .toBe("Documento complexo demais.");
    expect(parse({ ...emptyDocument(), tasks: Array.from({ length: 1000 }, () => ({})) }).errors).toHaveLength(50);
    expect(parseDocument(Buffer.from([0xc0, 0x80]))).toMatchObject({ schemaVersion: null, document: null });
  });
});

describe("preview token", () => {
  it("authenticates the exact bytes, session, tenant and operation and expires after fifteen minutes", () => {
    const secret = randomBytes(32).toString("base64url");
    const binding = {
      tenantId: randomUUID(), sessionId: randomUUID(), operationId: randomUUID(), digest: fileDigest(Buffer.from("{}")),
    };
    const start = 1_792_000_000_000;
    const { previewToken, expiresAt } = makePreviewToken(secret, binding, start);
    expect(new Date(expiresAt).getTime()).toBe(start + 900_000);
    expect(() => checkPreviewToken(previewToken, secret, binding, start + 899_999)).not.toThrow();
    for (const field of ["tenantId", "sessionId", "operationId", "digest"] as const) {
      expect(() => checkPreviewToken(previewToken, secret, { ...binding, [field]: randomUUID() }, start))
        .toThrow(expect.objectContaining({ code: "IMPORT_INVALID" }));
    }
    expect(() => checkPreviewToken(previewToken, secret, binding, start + 900_000))
      .toThrow(expect.objectContaining({ code: "PREVIEW_EXPIRED" }));
  });
});

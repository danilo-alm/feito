import "server-only";
import type { ProductAccess } from "@/server/db/product";
import { destinationIsEmpty, restoreDocument } from "@/server/db/portability";
import { countsFor } from "@/server/portability/document";
import {
  checkPreviewToken, fileDigest, invalidImport, makePreviewToken, receiptFingerprint,
} from "@/server/portability/token";
import { parseDocument } from "@/server/portability/validate";

export async function previewImport(
  access: ProductAccess, sessionId: string, operationId: string, secret: string, file: Uint8Array,
) {
  const parsed = parseDocument(file);
  const destinationEmpty = await destinationIsEmpty(access);
  const token = parsed.document && destinationEmpty
    ? makePreviewToken(secret, { sessionId, operationId, tenantId: access.tenantId, digest: fileDigest(file) })
    : { previewToken: null, expiresAt: null };
  return {
    schemaVersion: parsed.schemaVersion,
    counts: parsed.document ? countsFor(parsed.document) : null,
    errors: parsed.errors,
    destinationEmpty,
    ...token,
  };
}

export async function confirmImport(
  access: ProductAccess, sessionId: string, operationId: string, token: string, secret: string, file: Uint8Array,
) {
  const binding = { sessionId, operationId, tenantId: access.tenantId, digest: fileDigest(file) };
  checkPreviewToken(token, secret, binding);
  const parsed = parseDocument(file);
  if (!parsed.document) throw invalidImport(parsed.errors);
  return restoreDocument(access, parsed.document, operationId, receiptFingerprint(secret, binding));
}

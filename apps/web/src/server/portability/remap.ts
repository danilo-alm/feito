import "server-only";
import { randomUUID } from "node:crypto";
import type { PortableDocument } from "@feito/core/portability/document";
import { remapForImport as remap } from "@feito/core/portability/remap";

export function remapForImport(document: PortableDocument, inboxId: string, inboxRevision: number) {
  return remap(document, inboxId, inboxRevision, randomUUID);
}

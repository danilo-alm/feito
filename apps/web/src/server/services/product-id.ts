import "server-only";
import { randomUUID } from "node:crypto";
import type { ProductAccess } from "@/server/db/product";

export function allocateId(access: ProductAccess, slot: number) {
  return access.desktopOperation?.generatedIds[slot] ?? randomUUID();
}

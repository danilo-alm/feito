import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ImportSourceId } from "@feito/core/domain/import-sources";
import {
  applySourcePlan, invalidImport, newLabels, planSourceImport, projectPreview, readFiles, sourceCounts,
} from "@feito/core/portability/source-import";
import { findReceipt, replay } from "@/server/db/portability";
import { mutateProduct, readProduct, type ProductAccess } from "@/server/db/product";
import { withTenant } from "@/server/db/tenant";
import { checkPreviewToken, makePreviewToken, receiptFingerprint } from "@/server/portability/token";
import { importOperations } from "@/server/db/schema";

export { sourceFor } from "@feito/core/portability/source-import";

const binding = (access: ProductAccess, sessionId: string, operationId: string, source: ImportSourceId, file: Uint8Array) => ({
  sessionId, operationId, tenantId: access.tenantId,
  digest: createHash("sha256").update(`feito:import:${source}\0`).update(file).digest("base64url"),
});

export async function previewSourceImport(
  access: ProductAccess, sessionId: string, source: ImportSourceId, operationId: string, secret: string, file: Uint8Array,
) {
  const input = readFiles(file);
  const product = await readProduct(access, (snapshot) => snapshot);
  const result = planSourceImport(product, source, input);
  const token = result.plan
    ? makePreviewToken(secret, binding(access, sessionId, operationId, source, file))
    : { previewToken: null, expiresAt: null };
  return {
    source,
    target: result.target && { id: result.target.id, name: result.target.data.name },
    counts: result.plan ? sourceCounts(result.plan, newLabels(product, result.plan).size, result.target) : null,
    projects: result.plan ? projectPreview(result.plan) : [],
    warnings: result.warnings,
    errors: result.errors,
    referenceDate: product.referenceDate,
    ...token,
  };
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
  const receipt = await withTenant(access.db, access.tenantId, (tx) => findReceipt(tx, operationId));
  if (receipt) return replay(receipt, fingerprint);
  const input = readFiles(file);

  try {
    return await mutateProduct(access, (product) => {
      const result = planSourceImport(product, source, input);
      if (!result.plan) throw invalidImport(result.errors);
      const summary = sourceCounts(result.plan, newLabels(product, result.plan).size, result.target);
      return { operationId, summary, projectIds: applySourcePlan(product, result.plan, result.target, randomUUID) };
    }, undefined, {
      // Precisa verificar o recibo novamente sob o bloqueio do tenant, inclusive
      // quando uma operação já registrada perdeu o destino antes da nova tentativa.
      async beforeCommit(tx, outcome) {
        const receipt = await findReceipt(tx, operationId);
        if (receipt) throw new AlreadyImported(receipt);
        if ("value" in outcome) {
          await tx.insert(importOperations).values({
            tenantId: access.tenantId, operationId, fingerprint, summary: outcome.value.summary,
          });
        }
      },
    });
  } catch (error) {
    if (error instanceof AlreadyImported) return replay(error.receipt, fingerprint);
    throw error;
  }
}

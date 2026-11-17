import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/server/errors";

const PREVIEW_TTL_MS = 15 * 60 * 1000;

type PreviewBinding = {
  tenantId: string;
  sessionId: string;
  operationId: string;
  digest: string;
};

export const fileDigest = (file: Uint8Array) => createHash("sha256").update(file).digest("base64url");

function sign(secret: string, values: (number | string)[]) {
  return createHmac("sha256", secret).update(JSON.stringify(values)).digest();
}

function signature(secret: string, binding: PreviewBinding, expires: number) {
  const { tenantId, sessionId, operationId, digest } = binding;
  return sign(secret, ["feito:import:preview:1", expires, tenantId, sessionId, operationId, digest]);
}

export function receiptFingerprint(secret: string, binding: PreviewBinding) {
  return sign(secret, ["feito:import:receipt:1", binding.tenantId, binding.operationId, binding.digest]);
}

export function makePreviewToken(secret: string, binding: PreviewBinding, now = Date.now()) {
  const expires = now + PREVIEW_TTL_MS;
  return {
    previewToken: `1.${expires}.${signature(secret, binding, expires).toString("base64url")}`,
    expiresAt: new Date(expires).toISOString(),
  };
}

export function invalidImport(errors: { path: string; message: string }[]) {
  return new ApiError(422, "IMPORT_INVALID", "O arquivo ou a solicitação de importação é inválida.", { errors });
}

export function checkPreviewToken(token: string, secret: string, binding: PreviewBinding, now = Date.now()) {
  const format = /^1\.([1-9]\d{0,14})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (format) {
    const expires = Number(format[1]);
    const bytes = Buffer.from(format[2], "base64url");
    const expected = signature(secret, binding, expires);
    if (bytes.toString("base64url") === format[2] && timingSafeEqual(expected, bytes)) {
      if (expires <= now) throw new ApiError(410, "PREVIEW_EXPIRED", "A prévia venceu. Gere uma nova prévia.");
      return;
    }
  }
  throw invalidImport([{ path: "", message: "A prévia não corresponde ao arquivo, à sessão ou à operação." }]);
}

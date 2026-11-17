import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CipherError } from "@/server/crypto/envelope";
import { KeyBudgetError } from "@/server/db/product-crypto";
import { ApiError } from "@/server/errors";
import { logger } from "@/server/logger";

const CACHE = "private, no-store";
const MAX_JSON_BYTES = 16 * 1024;

export function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, { status, headers });
}

export function attachCookies(response: Response, cookies: string[]) {
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

export function requireOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin) {
    throw new ApiError(403, "FORBIDDEN_ORIGIN", "Origem da requisição não permitida.");
  }
}

const badJson = () => new ApiError(400, "MALFORMED_REQUEST", "Envie um corpo JSON válido.");
const bodyTooLarge = () => new ApiError(413, "PAYLOAD_TOO_LARGE", "O corpo excede o limite permitido.");

export async function readJson<T>(request: Request, schema: z.ZodType<T>, maxBytes = MAX_JSON_BYTES) {
  if (!request.body) throw badJson();
  if (Number(request.headers.get("content-length")) > maxBytes) throw bodyTooLarge();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 5_000);
  let value: unknown;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw bodyTooLarge();
      }
      chunks.push(next.value);
    }
    if (timedOut) throw badJson();
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
    value = JSON.parse(raw);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw badJson();
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  return validate(value, schema);
}

function validate<T>(value: unknown, schema: z.ZodType<T>) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fieldErrors = Object.fromEntries(result.error.issues.map(({ path }) => [
      path[0] ?? "_body", "Valor inválido.",
    ]));
    throw new ApiError(422, "VALIDATION_FAILED", "Revise os campos enviados.", { fieldErrors });
  }
  return result.data;
}

export function readQuery<T>(request: Request, schema: z.ZodType<T>) {
  const entries = [...new URL(request.url).searchParams];
  if (new Set(entries.map(([name]) => name)).size !== entries.length) {
    throw new ApiError(422, "VALIDATION_FAILED", "Revise os parâmetros enviados.", {
      fieldErrors: { _query: "Cada parâmetro deve ser informado apenas uma vez." },
    });
  }
  return validate(Object.fromEntries(entries), schema);
}

export function route<Context extends unknown[]>(
  path: string, operation: string, handle: (request: Request, ...context: Context) => Promise<Response>,
) {
  return async (request: Request, ...context: Context) => {
    const requestId = randomUUID();
    const start = performance.now();
    let response: Response;
    let code: string | undefined;
    try {
      response = await handle(request, ...context);
    } catch (error) {
      const known = error instanceof ApiError;
      const failure = known ? error : new ApiError(500, "INTERNAL_ERROR", "Não foi possível concluir a operação.");
      code = failure.code;
      response = json({ error: {
        code,
        message: failure.message,
        ...(failure.details && { details: failure.details }),
      } }, failure.status, failure.headers);
      if (!known) {
        const errorClass = error instanceof CipherError ? "crypto"
          : error instanceof KeyBudgetError ? "key_budget" : "unexpected";
        logger.error({ requestId, route: path, operation, code, errorClass });
      }
    }

    response.headers.set("Cache-Control", CACHE);
    logger.info({
      requestId,
      route: path,
      operation,
      durationMs: Math.round(performance.now() - start),
      status: response.status,
      code,
    });
    return response;
  };
}

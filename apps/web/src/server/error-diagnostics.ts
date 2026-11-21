import "server-only";

const SYSTEM_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
  "ENETUNREACH", "EHOSTUNREACH", "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);
const SAFE_MESSAGES = new Set([
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
  "Connection terminated unexpectedly",
  "Connection terminated",
  "Cannot use a pool after calling end on the pool",
  "self-signed certificate in certificate chain",
  "self-signed certificate",
  "certificate has expired",
  "unable to verify the first certificate",
]);

type Diagnostics = {
  type: string;
  code?: string;
  message?: string;
  frames?: string[];
  cause?: Diagnostics;
};

// Database wrappers can contain SQL and parameters in their message; never serialize
// the original error. Follow causes to retain driver codes without query contents.
export function errorDiagnostics(error: unknown, depth = 0): Diagnostics {
  if (!(error instanceof Error)) return { type: "NonError" };
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  const frames = error.stack?.split("\n").filter((line) =>
    /^\s+at (?:async )?(?:[\w.$<>]+ \()?[^\s()]+:\d+:\d+\)?$/.test(line),
  ).slice(0, 8);
  return {
    type: ["Error", "TypeError", "RangeError", "AggregateError", "SyntaxError"].includes(error.name)
      ? error.name : "Error",
    ...(code && (SYSTEM_CODES.has(code) || /^[0-9][0-9A-Z]{4}$/.test(code)) && { code }),
    ...(SAFE_MESSAGES.has(error.message) && { message: error.message }),
    ...(frames?.length && { frames }),
    ...(depth < 3 && error.cause !== undefined && { cause: errorDiagnostics(error.cause, depth + 1) }),
  };
}

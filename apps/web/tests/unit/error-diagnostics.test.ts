import { describe, expect, it, vi } from "vitest";
import { errorDiagnostics } from "@/server/error-diagnostics";
import { route } from "@/server/http/route";
import { logger } from "@/server/logger";

vi.mock("@/server/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

describe("error diagnostics", () => {
  it("preserves a connection timeout behind a query wrapper without logging private data", async () => {
    const cause = Object.assign(new Error("timeout exceeded when trying to connect"), { code: "ETIMEDOUT" });
    const error = new Error("Failed query: select private_task from tasks; params: password", { cause });
    const response = await route("/test", "test", async () => { throw error; })(new Request("http://localhost/test"));

    expect(response.status).toBe(500);
    const logged = vi.mocked(logger.error).mock.calls.at(-1)?.[0];
    expect(logged).toMatchObject({ error: { cause: {
      code: "ETIMEDOUT", message: "timeout exceeded when trying to connect",
    } } });
    expect(JSON.stringify(logged)).not.toMatch(/private_task|password/);
    expect(await response.json()).toEqual({ error: {
      code: "INTERNAL_ERROR", message: "Não foi possível concluir a operação.",
    } });
  });

  it("keeps SQLSTATE and stack locations but excludes multiline database details", () => {
    const error = Object.assign(new Error("duplicate key: private@example.test"), {
      code: "23505", detail: "private value", query: "private SQL",
    });
    error.stack = "Error: private@example.test\nsecret message\n    at connect (/app/server.js:42:7)";
    expect(errorDiagnostics(error)).toEqual({ type: "Error", code: "23505", frames: ["    at connect (/app/server.js:42:7)"] });
  });

  it("bounds cyclic causes and ignores arbitrary thrown objects", () => {
    const error = new Error("private");
    error.cause = error;
    expect(JSON.stringify(errorDiagnostics(error)).length).toBeLessThan(10_000);
    expect(errorDiagnostics({ password: "secret" })).toEqual({ type: "NonError" });
  });
});

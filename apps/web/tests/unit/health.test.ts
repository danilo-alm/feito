import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as live } from "@/app/api/health/live/route";
import { GET as health } from "@/app/api/health/route";
import { getRuntime } from "@/server/runtime";

vi.mock("@/server/runtime", () => ({ getRuntime: vi.fn() }));

describe("health checks", () => {
  beforeEach(() => vi.resetAllMocks());

  it("responds without authentication or database runtime even when the database is unavailable", async () => {
    vi.mocked(getRuntime).mockImplementation(() => { throw new Error("database unavailable"); });

    const response = await live(new Request("http://localhost/api/health/live"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ status: "ok" });
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it.each(["healthy", "domain unavailable", "identity unavailable"])("checks both database accesses: %s", async (state) => {
    const domain = vi.fn(async () => {
      if (state === "domain unavailable") throw new Error("unavailable");
    });
    const identity = vi.fn(async () => {
      if (state === "identity unavailable") throw new Error("unavailable");
    });
    vi.mocked(getRuntime).mockReturnValue({
      db: { execute: domain }, identity: { db: { execute: identity } },
    } as unknown as ReturnType<typeof getRuntime>);

    const response = await health(new Request("http://localhost/api/health"));

    expect(domain).toHaveBeenCalledOnce();
    expect(identity).toHaveBeenCalledOnce();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.status).toBe(state === "healthy" ? 200 : 503);
    expect(await response.json()).toEqual(state === "healthy" ? { status: "ok" } : {
      error: { code: "SERVICE_UNAVAILABLE", message: "Serviço temporariamente indisponível." },
    });
  });
});

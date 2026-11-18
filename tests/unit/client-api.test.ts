import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiFailure, configureApi } from "@/client/api";
import { addDays, dateLabel, dueLabel, longDate, nextWeek, rangeLabel } from "@/client/dates";

describe("api client", () => {
  afterEach(() => configureApi({ fetch: (input, init) => globalThis.fetch(input, init), onAuthFailure: undefined }));

  it("sends JSON with the method, path and query", async () => {
    const fetch = vi.fn(async () => Response.json({ projects: [] }));
    configureApi({ fetch });
    await api.projects.list("archived");
    await api.tasks.move("t1", 3, { type: "promote" });
    expect(fetch.mock.calls[0]).toEqual(["/api/v1/projects?status=archived", expect.objectContaining({ method: "GET" })]);
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/tasks/t1/move");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(init.body as string)).toEqual({ revision: 3, target: { type: "promote" } });
  });

  it("maps error envelopes and signals authentication failures", async () => {
    const onAuthFailure = vi.fn();
    configureApi({
      onAuthFailure,
      fetch: async (url) => url.endsWith("/navigation")
        ? Response.json({ error: { code: "UNAUTHENTICATED", message: "Entre novamente." } }, { status: 401 })
        : Response.json({ error: { code: "HAS_CHILDREN", message: "Confirme.", details: { childCount: 2 } } }, { status: 409 }),
    });
    await expect(api.navigation()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(onAuthFailure).toHaveBeenCalledWith("UNAUTHENTICATED");
    const failure = await api.tasks.remove("t1", 2).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure).toMatchObject({ code: "HAS_CHILDREN", details: { childCount: 2 } });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("does not redirect on a failed login and reports network errors", async () => {
    const onAuthFailure = vi.fn();
    configureApi({ onAuthFailure, fetch: async () => Response.json({ error: { code: "UNAUTHENTICATED", message: "x" } }, { status: 401 }) });
    await expect(api.auth.login("a@b.c", "x")).rejects.toMatchObject({ status: 401 });
    expect(onAuthFailure).not.toHaveBeenCalled();
    configureApi({ fetch: async () => { throw new TypeError("offline"); } });
    await expect(api.me()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("returns undefined for 204 responses", async () => {
    configureApi({ fetch: async () => new Response(null, { status: 204 }) });
    await expect(api.auth.logout()).resolves.toBeUndefined();
  });
});

describe("dates", () => {
  const today = "2026-11-17";
  it("labels civil dates relative to the reference day", () => {
    expect(dateLabel(today, today)).toBe("Hoje");
    expect(dateLabel("2026-11-18", today)).toBe("Amanhã");
    expect(dateLabel("2026-11-16", today)).toBe("Ontem");
    expect(dateLabel("2026-11-20", today)).toBe("Sex 20 nov");
    expect(dateLabel("2027-01-04", today)).toBe("Seg 4 jan 2027");
    expect(dueLabel(today, "14:00", today)).toBe("Hoje 14:00");
    expect(dueLabel(null, null, today)).toBeNull();
  });

  it("formats headers and ranges", () => {
    expect(longDate(today)).toBe("Terça, 17 de novembro");
    expect(rangeLabel("2026-11-18", "2026-11-24")).toBe("18 – 24 nov");
    expect(rangeLabel("2026-11-29", "2026-12-05")).toBe("29 nov – 5 dez");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(nextWeek(today)).toBe("2026-11-23");
    expect(nextWeek("2026-11-23")).toBe("2026-11-30");
  });
});

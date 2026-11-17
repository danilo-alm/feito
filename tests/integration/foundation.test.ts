import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { GET as health } from "@/app/api/health/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as changePassword } from "@/app/api/v1/auth/password/route";
import { GET as session } from "@/app/api/v1/auth/session/route";
import { GET as me } from "@/app/api/v1/me/route";
import { PATCH as patchPreferences } from "@/app/api/v1/preferences/route";
import { createAuth } from "@/server/auth/better-auth";
import { hashPassword } from "@/server/auth/password";
import { MAX_INVOCATIONS, unwrapDek } from "@/server/crypto/envelope";
import { connectDatabase } from "@/server/db/client";
import { account, dekUsage, preferences, projects, tasks, tenantKeys, tenants, user } from "@/server/db/schema";
import { createTask, getTask } from "@/server/services/tasks";
import { withTenant } from "@/server/db/tenant";
import { getRuntime } from "@/server/runtime";
import { administerAccount, createAccount, listAccounts } from "@/server/services/admin";
import { replacePassword } from "@/server/services/identity";

let runtime: ReturnType<typeof getRuntime>;
let admin: ReturnType<typeof connectDatabase>;
const ipHeader = "x-feito-test-ip";

beforeAll(() => {
  process.env.AUTH_CLIENT_IP_HEADER = ipHeader;
  runtime = getRuntime();
  admin = connectDatabase("IDENTITY_ADMIN_DATABASE_URL", 4);
});

afterAll(async () => {
  await Promise.all([runtime?.close(), admin?.close()]);
});

function testIp() {
  const seed = randomBytes(4).toString("hex");
  return `2001:db8::${seed.slice(0, 4)}:${seed.slice(4)}`;
}

function request(path: string, init: {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string | null;
  ip?: string;
  raw?: string;
} = {}) {
  const { origin } = runtime.identity.config;
  const headers = new Headers({ [ipHeader]: init.ip ?? testIp() });
  if (init.origin !== null) headers.set("Origin", init.origin ?? origin);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body !== undefined || init.raw !== undefined) headers.set("Content-Type", "application/json");
  return new Request(origin + path, {
    method: init.method ?? "GET",
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const randomPassword = () => randomBytes(30).toString("base64url");

async function fixture(password = randomPassword()) {
  const email = `${randomUUID()}@example.test`;
  const id = await createAccount({ db: admin.db, config: runtime.identity.config }, email, password);
  const [identity] = await admin.db.select({ tenantId: user.tenantId }).from(user).where(eq(user.id, id));
  return { id, email, password, tenantId: identity.tenantId };
}

function signIn(email: string, password: string, ip?: string) {
  return login(request("/api/v1/auth/login", { method: "POST", body: { email, password }, ip }));
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("__Secure-feito.session_token="));
  expect(cookie).toBeDefined();
  expect(cookie).toMatch(/; Secure(?:;|$)/i);
  expect(cookie).toMatch(/; HttpOnly(?:;|$)/i);
  expect(cookie).toMatch(/; SameSite=Lax(?:;|$)/i);
  return cookie!.split(";")[0];
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ error: { code, message: expect.any(String) } });
}

function readMe(cookie: string) {
  return me(request("/api/v1/me", { cookie }));
}

function patch(cookie: string, body: unknown) {
  return patchPreferences(request("/api/v1/preferences", { method: "PATCH", cookie, body }));
}

function passwordChange(cookie: string, currentPassword: string, newPassword: string) {
  return changePassword(request("/api/v1/auth/password", {
    method: "POST", cookie, body: { currentPassword, newPassword },
  }));
}

async function onboard() {
  const identity = await fixture();
  const cookie = cookieFrom(await signIn(identity.email, identity.password));
  const password = randomPassword();
  expect((await passwordChange(cookie, identity.password, password)).status).toBe(204);
  const response = await readMe(cookie);
  expect(response.status).toBe(200);
  const { inboxProjectId } = await response.json() as { inboxProjectId: string };
  return { ...identity, password, cookie, inboxProjectId };
}

describe("Phase 1 HTTP contract", () => {
  it("returns health without authentication and rejects unauthenticated access", async () => {
    const response = await health(request("/api/health", { origin: null }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ status: "ok" });
    await expectError(await session(request("/api/v1/auth/session")), 401, "UNAUTHENTICATED");
    await expectError(await session(request("/api/v1/auth/session", { cookie: "__Secure-feito.session_token=forged" })),
      401, "UNAUTHENTICATED");
    await expectError(await me(request("/api/v1/me")), 401, "UNAUTHENTICATED");
  });

  it("validates the exact origin, malformed/oversized JSON and input fields", async () => {
    for (const origin of [null, "https://outside.example"]) {
      await expectError(await login(request("/api/v1/auth/login", { method: "POST", origin })),
        403, "FORBIDDEN_ORIGIN");
      await expectError(await patchPreferences(request("/api/v1/preferences", { method: "PATCH", origin })),
        403, "FORBIDDEN_ORIGIN");
    }
    for (const raw of [undefined, ""]) {
      await expectError(await login(request("/api/v1/auth/login", { method: "POST", raw })), 400, "MALFORMED_REQUEST");
    }
    await expectError(await login(request("/api/v1/auth/login", { method: "POST", raw: "x".repeat(17_000) })),
      413, "PAYLOAD_TOO_LARGE");
    const invalid = await login(request("/api/v1/auth/login", {
      method: "POST", body: { email: "invalid", password: "x" },
    }));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: {
      code: "VALIDATION_FAILED", details: { fieldErrors: { email: "Valor inválido." } },
    } });
  });

  it("uses the restricted adapter and Argon2id without provisioning a session", async () => {
    const identity = await fixture();
    const [credential] = await admin.db.select({ password: account.password }).from(account)
      .where(eq(account.userId, identity.id));
    expect(credential.password).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
    const result = await admin.db.execute<{ count: number }>(sql`
      select count(*)::integer as count from identity.session where user_id = ${identity.id}
    `);
    expect(result.rows[0].count).toBe(0);
    await expect(createAuth(runtime.identity.db, runtime.identity.config).api.signUpEmail({
      body: { name: "Sintético", email: `${randomUUID()}@example.test`, password: randomPassword() },
    })).rejects.toMatchObject({ statusCode: 400, body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" } });
  });

  it("permits only onboarding routes with a provisional password and revokes other sessions after change", async () => {
    const identity = await fixture();
    const first = await signIn(` ${identity.email.toUpperCase()} `, identity.password);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ user: { id: identity.id, email: identity.email }, mustChangePassword: true });
    const cookie = cookieFrom(first);
    const other = cookieFrom(await signIn(identity.email, identity.password));
    const authState = await session(request("/api/v1/auth/session", { cookie }));
    expect(authState.status).toBe(200);
    expect(await authState.json()).toMatchObject({ mustChangePassword: true });

    const accounts = await Promise.all([readMe(cookie), readMe(other)]);
    expect(accounts.map((response) => response.status)).toEqual([200, 200]);
    const [a, b] = await Promise.all(accounts.map((response) => response.json()));
    expect(a).toEqual(b);
    expect(a).toEqual({
      user: { id: identity.id, email: identity.email },
      mustChangePassword: true,
      preferences: { timezone: "America/Maceio", theme: "system" },
      referenceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      inboxProjectId: expect.any(String),
    });
    const rows = await withTenant(runtime.db, identity.tenantId, (tx) => tx.select().from(projects));
    expect(rows).toHaveLength(1);

    await expectError(await patch(cookie, { theme: "dark" }), 403, "PASSWORD_CHANGE_REQUIRED");
    await expectError(await passwordChange(cookie, identity.password, "short"), 422, "WEAK_PASSWORD");
    await expectError(await passwordChange(cookie, identity.password, identity.password), 422, "VALIDATION_FAILED");
    const next = randomPassword();
    await expectError(await passwordChange(cookie, randomPassword(), next), 401, "INVALID_CREDENTIALS");
    expect((await passwordChange(cookie, identity.password, next)).status).toBe(204);
    await expectError(await session(request("/api/v1/auth/session", { cookie: other })), 401, "UNAUTHENTICATED");
    const current = await session(request("/api/v1/auth/session", { cookie }));
    expect(await current.json()).toMatchObject({ mustChangePassword: false });
    await expectError(await signIn(identity.email, identity.password), 401, "INVALID_CREDENTIALS");
  });

  it("revokes only the current session on logout, including for provisional passwords", async () => {
    const identity = await fixture();
    const one = cookieFrom(await signIn(identity.email, identity.password));
    const two = cookieFrom(await signIn(identity.email, identity.password));
    const response = await logout(request("/api/v1/auth/logout", { method: "POST", cookie: one }));
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().join(" ")).toMatch(/Max-Age=0/i);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expectError(await session(request("/api/v1/auth/session", { cookie: one })), 401, "UNAUTHENTICATED");
    expect((await session(request("/api/v1/auth/session", { cookie: two }))).status).toBe(200);
  });

  it("rate-limits canonical email across IPs and IP across emails", async () => {
    const email = `${randomUUID()}@example.test`;
    const password = randomPassword();
    for (let attempt = 0; attempt < 8; attempt++) {
      await expectError(await signIn(email, password), 401, "INVALID_CREDENTIALS");
    }
    const emailLimited = await signIn(` ${email.toUpperCase()} `, password);
    expect(Number(emailLimited.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expectError(emailLimited, 429, "RATE_LIMITED");

    const ip = testIp();
    for (let attempt = 0; attempt < 30; attempt++) {
      await expectError(await signIn(`${randomUUID()}@example.test`, password, ip), 401, "INVALID_CREDENTIALS");
    }
    const ipLimited = await signIn(`${randomUUID()}@example.test`, password, ip);
    expect(Number(ipLimited.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expectError(ipLimited, 429, "RATE_LIMITED");
  }, 20_000);

  it("disables, reenables, resets and explicitly revokes through local administration", async () => {
    const identity = await onboard();
    const store = { db: admin.db, config: runtime.identity.config };
    await administerAccount(store, "account:disable", identity.email);
    await expectError(await signIn(identity.email, identity.password), 401, "INVALID_CREDENTIALS");
    await expectError(await readMe(identity.cookie), 401, "UNAUTHENTICATED");
    expect(await listAccounts(store)).toContainEqual({
      email: identity.email, enabled: false, createdAt: expect.any(Date),
    });
    await administerAccount(store, "account:enable", identity.email);
    const fresh = cookieFrom(await signIn(identity.email, identity.password));
    await administerAccount(store, "account:revoke-sessions", identity.email);
    await expectError(await readMe(fresh), 401, "UNAUTHENTICATED");

    const beforeReset = cookieFrom(await signIn(identity.email, identity.password));
    const temporary = randomPassword();
    await administerAccount(store, "account:reset-password", identity.email, temporary);
    await expectError(await readMe(beforeReset), 401, "UNAUTHENTICATED");
    await expectError(await signIn(identity.email, identity.password), 401, "INVALID_CREDENTIALS");
    const afterReset = await signIn(identity.email, temporary);
    const resetCookie = cookieFrom(afterReset);
    expect(await afterReset.json()).toMatchObject({ mustChangePassword: true });
    expect(await (await readMe(resetCookie)).json()).toMatchObject({ inboxProjectId: identity.inboxProjectId });
    await expectError(await patch(resetCookie, { theme: "dark" }), 403, "PASSWORD_CHANGE_REQUIRED");
  });

  it("rejects a session emission racing a committed password reset", async () => {
    const identity = await fixture();
    const digest = await hashPassword(randomPassword());
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const reset = admin.db.transaction(async (tx) => {
      await tx.select({ id: user.id }).from(user).where(eq(user.id, identity.id)).for("update");
      await replacePassword(tx, identity.id, digest, true);
      held.resolve();
      await release.promise;
    });
    await Promise.race([held.promise, reset]);
    const inFlight = signIn(identity.email, identity.password);
    try {
      await vi.waitFor(async () => {
        const result = await runtime.identity.db.execute<{ waiting: boolean }>(sql`
          select exists (
            select 1 from pg_locks as waiting
            join pg_locks as holding using (locktype, transactionid)
            join pg_stat_activity as waiter on waiter.pid = waiting.pid
            join pg_stat_activity as holder on holder.pid = holding.pid
            where not waiting.granted and holding.granted
              and waiter.usename = 'feito_auth' and holder.usename = 'feito_identity_admin'
          ) as waiting
        `);
        expect(result.rows[0].waiting).toBe(true);
      }, { timeout: 3_000, interval: 20 });
    } finally {
      release.resolve();
      await reset;
    }
    await expectError(await inFlight, 401, "INVALID_CREDENTIALS");
  });
});

describe("PostgreSQL roles, RLS and encrypted storage", () => {
  it("runs on PostgreSQL 18 with forced RLS and separately scoped roles", async () => {
    const { db, identity } = runtime;
    const result = await db.execute<{ name: string; version: string; rolsuper: boolean; rolbypassrls: boolean }>(sql`
      select current_user as name, current_setting('server_version_num') as version, rolsuper, rolbypassrls
        from pg_roles where rolname = current_user
    `);
    expect(result.rows[0]).toMatchObject({
      name: "feito_app", version: expect.stringMatching(/^18\d{4}$/), rolsuper: false, rolbypassrls: false,
    });
    const policies = await db.execute<{ rls: boolean; forced: boolean; owned: boolean }>(sql`
      select relrowsecurity as rls, relforcerowsecurity as forced, pg_get_userbyid(relowner) = current_user as owned
        from pg_class join pg_namespace on pg_namespace.oid = relnamespace
        where nspname = 'domain' and relkind = 'r'
    `);
    expect(policies.rows).toHaveLength(11);
    for (const row of policies.rows) expect(row).toEqual({ rls: true, forced: true, owned: false });
    await expect(db.select().from(user)).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(identity.db.select().from(tenants)).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(admin.db.select().from(tenantKeys)).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(db.execute(sql`select * from crypto_ops.kek_usage`)).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("keeps two workspaces isolated, hides foreign IDs and rejects cross-tenant foreign keys", async () => {
    const [a, b] = await Promise.all([onboard(), onboard()]);
    const { db, keys } = runtime;
    expect(a.inboxProjectId).not.toBe(b.inboxProjectId);
    const [one, two] = await Promise.all([
      patch(a.cookie, { theme: "dark" }),
      patch(a.cookie, { timezone: "Pacific/Auckland" }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(await (await readMe(a.cookie)).json()).toMatchObject({
      preferences: { theme: "dark", timezone: "Pacific/Auckland" },
    });
    expect(await (await readMe(b.cookie)).json()).toMatchObject({
      preferences: { theme: "system", timezone: "America/Maceio" },
    });
    await expectError(await patch(b.cookie, { tenantId: a.tenantId, theme: "dark" }), 422, "VALIDATION_FAILED");
    await expectError(await patch(b.cookie, { timezone: "Etc/Invalid" }), 422, "VALIDATION_FAILED");

    const payload = { title: "Título sintético", description: "Descrição sintética", priority: 4 } as const;
    const accessA = { db, keys, tenantId: a.tenantId };
    const accessB = { db, keys, tenantId: b.tenantId };
    const taskA = (await createTask(accessA, { ...payload, projectId: a.inboxProjectId })).id;
    const taskB = (await createTask(accessB, { ...payload, projectId: b.inboxProjectId })).id;
    await expect(getTask(accessA, taskA)).resolves.toMatchObject(payload);
    await expect(getTask(accessB, taskB)).resolves.toMatchObject(payload);
    for (const foreignId of [taskA, randomUUID()]) {
      await expect(getTask(accessB, foreignId)).rejects.toMatchObject({
        status: 404, code: "NOT_FOUND", message: "Recurso não encontrado.",
      });
    }
    await expect(createTask(accessB, { ...payload, projectId: a.inboxProjectId }))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });

    const [storedA] = await withTenant(db, a.tenantId, (tx) => tx.select().from(tasks));
    const [storedB] = await withTenant(db, b.tenantId, (tx) => tx.select().from(tasks));
    expect(storedA.ciphertext).not.toEqual(storedB.ciphertext);
    expect(storedA.ciphertext.toString("utf8")).not.toContain(payload.title);
    expect(storedA.ciphertext.toString("utf8")).not.toContain(payload.description);
    const [envelopeA] = await withTenant(db, a.tenantId, (tx) => tx.select().from(tenantKeys));
    const [envelopeB] = await withTenant(db, b.tenantId, (tx) => tx.select().from(tenantKeys));
    const dekA = unwrapDek(keys, envelopeA);
    const dekB = unwrapDek(keys, envelopeB);
    try {
      expect(dekA).not.toEqual(dekB);
    } finally {
      dekA.fill(0);
      dekB.fill(0);
    }

    await expect(withTenant(db, b.tenantId, (tx) => tx.insert(tasks).values({ ...storedA, id: randomUUID() })))
      .rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(withTenant(db, b.tenantId, (tx) => tx.insert(tasks).values({
      ...storedB, id: randomUUID(), projectId: a.inboxProjectId,
    }))).rejects.toMatchObject({ cause: { code: "23503" } });

    // Force connection reuse to verify a COMMIT or ROLLBACK cannot leave tenant scope behind.
    const oneConnection = connectDatabase("DOMAIN_DATABASE_URL", 1);
    try {
      const shared = oneConnection.db;
      expect(await shared.select().from(tasks)).toEqual([]);
      expect(await withTenant(shared, a.tenantId, (tx) => tx.select({ id: tasks.id }).from(tasks))).toEqual([{ id: taskA }]);
      expect(await shared.select().from(tasks)).toEqual([]);
      expect(await withTenant(shared, b.tenantId, (tx) => tx.select({ id: tasks.id }).from(tasks))).toEqual([{ id: taskB }]);
      expect(await withTenant(shared, "malformed", (tx) => tx.select().from(tasks))).toEqual([]);
      await expect(withTenant(shared, a.tenantId, async () => { throw new Error("rollback fixture"); }))
        .rejects.toThrow("rollback fixture");
      expect(await shared.select().from(tasks)).toEqual([]);
      await expect(shared.insert(tasks).values({ ...storedA, id: randomUUID() }))
        .rejects.toMatchObject({ cause: { code: "42501" } });
    } finally {
      await oneConnection.close();
    }
  });

  it("rolls back a preference mutation when authentication fails and keeps the DEK reservation", async () => {
    const target = await onboard();
    const { db } = runtime;
    const brokenTag = randomBytes(16);
    const where = eq(preferences.tenantId, target.tenantId);
    const [original] = await withTenant(db, target.tenantId, (tx) => tx.select().from(preferences).where(where));
    const counter = () => withTenant(db, target.tenantId, async (tx) => {
      const [row] = await tx.select().from(dekUsage).where(and(
        eq(dekUsage.tenantId, target.tenantId), eq(dekUsage.dekVersion, original.dekVersion),
      ));
      return row.invocations;
    });
    const reserved = await counter();
    await withTenant(db, target.tenantId, (tx) => tx.update(preferences).set({ tag: brokenTag }).where(where));
    try {
      await expectError(await patch(target.cookie, { theme: "dark" }), 500, "INTERNAL_ERROR");
      const [afterFailure] = await withTenant(db, target.tenantId, (tx) => tx.select().from(preferences).where(where));
      expect(afterFailure).toEqual({ ...original, tag: brokenTag });
      expect(await counter()).toBe(reserved + 1);
    } finally {
      await withTenant(db, target.tenantId, (tx) => tx.update(preferences).set({ tag: original.tag }).where(where));
    }
    expect(await (await readMe(target.cookie)).json()).toMatchObject({ preferences: { theme: "system" } });
  });

  it("refuses to encrypt after the DEK invocation budget is exhausted", async () => {
    const target = await onboard();
    const { db } = runtime;
    const where = and(eq(dekUsage.tenantId, target.tenantId), eq(dekUsage.dekVersion, 1));
    await withTenant(db, target.tenantId, (tx) => tx.update(dekUsage)
      .set({ invocations: MAX_INVOCATIONS - 1 }).where(where));

    expect((await patch(target.cookie, { theme: "dark" })).status).toBe(200);
    await expectError(await patch(target.cookie, { theme: "light" }), 500, "INTERNAL_ERROR");
    expect(await (await readMe(target.cookie)).json()).toMatchObject({ preferences: { theme: "dark" } });
    const [usage] = await withTenant(db, target.tenantId, (tx) => tx.select().from(dekUsage).where(where));
    expect(usage.invocations).toBe(MAX_INVOCATIONS);
  });
});

import "server-only";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { APIError as BetterAuthError } from "better-auth/api";
import type { AuthConfig } from "@/server/crypto/config";
import { createAuth } from "@/server/auth/better-auth";
import { withLoginAttempt } from "@/server/auth/login-limit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import type { Database, Transaction } from "@/server/db/client";
import { account, session, user } from "@/server/db/schema";
import { ApiError, invalidCredentials, unauthenticated, weakPassword } from "@/server/errors";
import { validNewPassword } from "@/validation/account";

type IdentityUser = Pick<typeof user.$inferSelect, "id" | "email" | "tenantId" | "mustChangePassword">;
export type IdentitySession = IdentityUser & { sessionId: string };
export type IdentityStore = { db: Database; config: AuthConfig };

export function publicIdentity(identity: IdentityUser) {
  return {
    user: { id: identity.id, email: identity.email },
    mustChangePassword: identity.mustChangePassword,
  };
}

function authHeaders(headers: Headers, origin: string) {
  const allowed = new Headers({ origin });
  const cookie = headers.get("cookie");
  if (cookie) allowed.set("cookie", cookie);
  return allowed;
}

export async function login(
  { db, config }: IdentityStore, input: { email: string; password: string }, headers: Headers,
) {
  return withLoginAttempt(db, config, input.email, headers, () => db.transaction(async (tx) => {
    const [snapshot] = await tx.select({ id: user.id, revision: user.credentialRevision })
      .from(user).where(eq(user.email, input.email));
    let authorized: typeof user.$inferSelect | undefined;
    const auth = createAuth(tx, config, {
      authorizeSessionCreation: async (userId) => {
        const [current] = await tx.select().from(user).where(and(
          eq(user.id, userId), eq(user.credentialRevision, snapshot?.revision ?? 0),
        )).for("update");
        if (!current?.enabled || snapshot?.id !== userId) return false;
        authorized = current;
        return true;
      },
    });

    try {
      const result = await auth.api.signInEmail({
        body: input, headers: new Headers({ origin: config.origin }), returnHeaders: true,
      });
      if (!authorized) throw invalidCredentials();
      return { identity: publicIdentity(authorized), cookies: result.headers.getSetCookie() };
    } catch (error) {
      if (error instanceof BetterAuthError && error.statusCode === 401) throw invalidCredentials();
      throw error;
    }
  }));
}

export async function withSession<T>(
  { db, config }: IdentityStore,
  headers: Headers,
  options: { allowProvisional: boolean; lock?: "share" | "update" },
  run: (identity: IdentitySession, tx: Transaction) => Promise<T>,
) {
  const active = await createAuth(db, config).api.getSession({
    headers: authHeaders(headers, config.origin),
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!active) throw unauthenticated();

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(user)
      .where(eq(user.id, active.user.id)).for(options.lock ?? "share");
    if (!current?.enabled) throw unauthenticated();
    // Recheck the already authenticated session under the same lock used
    // by credential changes, administrative revocation and logout.
    const [valid] = await tx.select({ id: session.id }).from(session).where(and(
      eq(session.id, active.session.id), eq(session.userId, current.id), gt(session.expiresAt, sql`now()`),
    ));
    if (!valid) throw unauthenticated();
    const expectedAccount = headers.get("X-Feito-Account");
    if (expectedAccount !== null && expectedAccount !== current.id) {
      throw new ApiError(409, "DESKTOP_ACCOUNT_CHANGED", "A solicitação pertence a outra conta.");
    }
    if (current.mustChangePassword && !options.allowProvisional) {
      throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "Altere a senha para continuar.");
    }
    const { id, email, tenantId, mustChangePassword } = current;
    return run({ id, email, tenantId, mustChangePassword, sessionId: valid.id }, tx);
  });
}

export function logout(store: IdentityStore, headers: Headers) {
  return withSession(store, headers, { allowProvisional: true, lock: "update" }, async (identity, tx) => {
    await tx.delete(session).where(eq(session.id, identity.sessionId));
    // Generate Better Auth's clearing cookies. The verified session was already deleted above.
    const result = await createAuth(tx, store.config).api.signOut({
      headers: new Headers({ origin: store.config.origin }), returnHeaders: true,
    });
    return result.headers.getSetCookie();
  });
}

export async function replacePassword(
  tx: Transaction, userId: string, digest: string, provisional: boolean, keepSessionId?: string,
) {
  const now = new Date();
  const updated = await tx.update(account).set({ password: digest, updatedAt: now }).where(and(
    eq(account.userId, userId), eq(account.providerId, "credential"),
  )).returning({ id: account.id });
  if (updated.length !== 1) throw new Error("Credencial indisponível.");
  await tx.update(user).set({
    mustChangePassword: provisional,
    credentialRevision: sql`${user.credentialRevision} + 1`,
    updatedAt: now,
  }).where(eq(user.id, userId));
  await tx.delete(session).where(and(eq(session.userId, userId),
    keepSessionId ? ne(session.id, keepSessionId) : undefined));
}

export async function changePassword(
  tx: Transaction, identity: IdentitySession, input: { currentPassword: string; newPassword: string },
) {
  if (!validNewPassword.safeParse(input.newPassword).success) throw weakPassword();
  const [credential] = await tx.select({ password: account.password }).from(account).where(and(
    eq(account.userId, identity.id), eq(account.providerId, "credential"),
  ));
  if (!credential?.password || !await verifyPassword(credential.password, input.currentPassword)) {
    throw invalidCredentials();
  }
  if (input.currentPassword === input.newPassword) {
    throw new ApiError(422, "VALIDATION_FAILED", "Escolha uma senha diferente da atual.", {
      fieldErrors: { newPassword: "Use uma senha diferente da atual." },
    });
  }
  const digest = await hashPassword(input.newPassword);
  await replacePassword(tx, identity.id, digest, false, identity.sessionId);
}

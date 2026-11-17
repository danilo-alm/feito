import "server-only";
import { eq, sql } from "drizzle-orm";
import { createAuth } from "@/server/auth/better-auth";
import { hashPassword } from "@/server/auth/password";
import { session, user } from "@/server/db/schema";
import { ApiError, weakPassword } from "@/server/errors";
import { validNewPassword } from "@/validation/account";
import { replacePassword, type IdentityStore } from "./identity";

export type AccountAction = "account:reset-password" | "account:revoke-sessions" | "account:disable" | "account:enable";

export async function createAccount({ db, config }: IdentityStore, email: string, password: string) {
  if (!validNewPassword.safeParse(password).success) throw weakPassword();
  return db.transaction(async (tx) => {
    const result = await createAuth(tx, config, { localAdmin: true }).api.signUpEmail({
      body: { name: "Feito", email, password },
    });
    return result.user.id;
  });
}

export function listAccounts({ db }: IdentityStore) {
  return db.select({
    email: user.email, enabled: user.enabled, createdAt: user.createdAt,
  }).from(user).orderBy(user.createdAt, user.id);
}

export async function administerAccount(
  { db }: IdentityStore, action: AccountAction, email: string, password?: string,
) {
  let digest: string | undefined;
  if (action === "account:reset-password") {
    if (!password || !validNewPassword.safeParse(password).success) throw weakPassword();
    digest = await hashPassword(password);
  }
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).for("update");
    if (!target) throw new ApiError(404, "NOT_FOUND", "Conta não encontrada.");

    if (digest) {
      await replacePassword(tx, target.id, digest, true);
    } else {
      const enabled = action === "account:enable" ? true : action === "account:disable" ? false : undefined;
      await tx.update(user).set({
        enabled,
        credentialRevision: sql`${user.credentialRevision} + 1`,
        updatedAt: new Date(),
      }).where(eq(user.id, target.id));
      if (action !== "account:enable") await tx.delete(session).where(eq(session.userId, target.id));
    }
    return target.id;
  });
}

import "server-only";
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { AuthConfig } from "@/server/crypto/config";
import type { Database, Transaction } from "@/server/db/client";
import { authSchema } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "./password";

export function createAuth(
  db: Database | Transaction,
  config: AuthConfig,
  options: { localAdmin?: boolean; authorizeSessionCreation?: (userId: string) => Promise<boolean> } = {},
) {
  return betterAuth({
    appName: "Feito",
    baseURL: config.origin,
    basePath: "/api/v1/auth",
    trustedOrigins: [config.origin],
    secret: config.secret,
    // The service owns the outer transaction, including the session-creation check.
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema, transaction: false }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.localAdmin,
      autoSignIn: false,
      minPasswordLength: 5,
      // Better Auth counts UTF-16 units. The Feito boundary enforces 128 Unicode characters.
      maxPasswordLength: 256,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      cookieCache: { enabled: false },
      disableSessionRefresh: true,
      deferSessionRefresh: true,
    },
    advanced: {
      useSecureCookies: true,
      cookiePrefix: "feito",
      database: { generateId: () => randomUUID() },
      ipAddress: { disableIpTracking: true },
    },
    rateLimit: { enabled: false }, // The API uses shared database buckets for both email and IP.
    logger: { disabled: true },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => !!await options.authorizeSessionCreation?.(session.userId),
        },
      },
    },
  });
}

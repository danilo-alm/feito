import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import type { AuthConfig } from "@/server/crypto/config";
import type { Database } from "@/server/db/client";
import { ApiError } from "@/server/errors";

const WINDOW_SECONDS = 15 * 60;
const EMAIL_ATTEMPTS = 8;
const IP_ATTEMPTS = 30;
const MAX_CONCURRENT_LOGINS = 2;
let activeLogins = 0;

function rateLimited(seconds: number) {
  return new ApiError(429, "RATE_LIMITED", "Muitas tentativas. Tente novamente mais tarde.",
    undefined, { "Retry-After": String(seconds) });
}

function clientIp(header: string | undefined, headers: Headers) {
  const value = header ? headers.get(header)?.trim() : undefined;
  if (!value) return "unknown";
  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6 && !value.includes("%")) return new URL(`http://[${value}]`).hostname;
  return "unknown";
}

async function reserveAttempts(db: Database, config: AuthConfig, email: string, headers: Headers) {
  const buckets = [
    { kind: "email", value: email, max: EMAIL_ATTEMPTS },
    { kind: "ip", value: clientIp(config.clientIpHeader, headers), max: IP_ATTEMPTS },
  ];

  // Reclaim stale rows without waiting for concurrent reservations.
  await db.execute(sql`
    delete from identity.login_limits where key in (
      select key from identity.login_limits where expires_at <= now()
      limit 100 for update skip locked
    )
  `);
  const retryAfter = await db.transaction(async (tx) => {
    let seconds = 0;
    // Every request locks the email bucket first and the IP bucket second.
    for (const bucket of buckets) {
      const key = createHmac("sha256", config.secret).update(`${bucket.kind}:${bucket.value}`).digest("hex");
      const result = await tx.execute<{ attempts: number; retry_after: number }>(sql`
        insert into identity.login_limits as bucket (key, attempts, expires_at)
        values (${key}, 1, now() + make_interval(secs => ${WINDOW_SECONDS}))
        on conflict (key) do update set
          attempts = case when bucket.expires_at <= now() then 1
                          else least(bucket.attempts + 1, ${bucket.max + 1}) end,
          expires_at = case when bucket.expires_at <= now() then excluded.expires_at
                            else bucket.expires_at end
        returning attempts, greatest(1, ceil(extract(epoch from (expires_at - now()))))::integer as retry_after
      `);
      const row = result.rows[0];
      if (row.attempts > bucket.max) seconds = Math.max(seconds, row.retry_after);
    }
    return seconds;
  });
  if (retryAfter) throw rateLimited(retryAfter);
}

export async function withLoginAttempt<T>(
  db: Database, config: AuthConfig, email: string, headers: Headers, run: () => Promise<T>,
) {
  if (activeLogins >= MAX_CONCURRENT_LOGINS) throw rateLimited(1);
  activeLogins++;
  try {
    await reserveAttempts(db, config, email, headers);
    return await run();
  } finally {
    activeLogins--;
  }
}

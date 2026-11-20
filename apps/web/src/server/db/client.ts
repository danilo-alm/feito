import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseUrl } from "@/server/crypto/config";
import { logger } from "@/server/logger";

export function connectDatabase(name: string, max: number) {
  const pool = new Pool({
    connectionString: databaseUrl(name),
    max,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
  });
  pool.on("error", () => logger.error({ operation: "idle_database_connection", code: "DATABASE_ERROR" }));
  return { db: drizzle(pool), close: () => pool.end() };
}

export type Database = ReturnType<typeof connectDatabase>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

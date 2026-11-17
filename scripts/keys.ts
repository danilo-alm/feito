import "server-only";
import { userInfo } from "node:os";
import { readKeyConfig } from "@/server/crypto/config";
import { connectDatabase } from "@/server/db/client";
import { activateDek, rekeyWithActiveDek, rewrapKek } from "@/server/db/rotation";
import { logger } from "@/server/logger";
import { entityId } from "@/validation/product";

const commands = {
  "kek:rewrap": rewrapKek,
  "dek:activate": activateDek,
  "dek:rekey": rekeyWithActiveDek,
};

async function main() {
  const [command, flag, id, ...rest] = process.argv.slice(2);
  const tenant = entityId.safeParse(id);
  if (!command || !Object.hasOwn(commands, command) || flag !== "--tenant" || !tenant.success || rest.length) {
    process.stderr.write("Uso: pnpm keys <kek:rewrap|dek:activate|dek:rekey> --tenant UUID\n");
    process.exitCode = 1;
    return;
  }
  const operation = command as keyof typeof commands;
  const operator = userInfo().uid;
  const tenantId = tenant.data;
  let close: (() => Promise<void>) | undefined;
  try {
    const keys = readKeyConfig();
    const connection = connectDatabase("KEY_MAINTENANCE_DATABASE_URL", 1);
    close = connection.close;
    const result = await commands[operation]({ db: connection.db, keys, tenantId });
    logger.info({
      operation, operator, tenantId, outcome: "ok",
      ...(operation === "dek:activate" ? { dekVersion: result } : { rewritten: result }),
    });
  } catch {
    logger.error({ operation, operator, tenantId, outcome: "failed" });
    process.exitCode = 1;
  } finally {
    await close?.();
  }
}

main().catch(() => {
  process.stderr.write("Não foi possível executar a manutenção de chaves.\n");
  process.exitCode = 1;
});

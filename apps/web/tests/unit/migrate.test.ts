import { execFile } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);

describe("pnpm db:migrate", () => {
  it.each([
    ["a rejected connection", "28P01"],
    ["an unresponsive server", "tempo limite de 10 s"],
  ])("logs the cause of %s and exits with failure", async (_, expected) => {
    const secret = "fake-migrator-password";
    let connection: Socket | undefined;
    const server = createServer((socket) => {
      connection = socket;
      if (expected !== "28P01") return;
      // PostgreSQL ErrorResponse, with a message that must stay out of the logs.
      const payload = Buffer.from(`SFATAL\0C28P01\0Mpassword rejected: ${secret}\0\0`);
      const header = Buffer.alloc(5);
      header.write("E");
      header.writeInt32BE(4 + payload.length, 1);
      socket.once("data", () => socket.end(Buffer.concat([header, payload])));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing TCP address");
      const run = exec("pnpm", ["db:migrate"], {
        env: {
          ...process.env,
          APP_SECRETS_DIR: "",
          MIGRATION_DATABASE_URL: `postgresql://migrator:${secret}@127.0.0.1:${address.port}/test?sslmode=disable`,
        },
        timeout: 16_000,
      });

      await expect(run).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(`Falha ao conectar ao PostgreSQL (${expected})`),
      });
      await expect(run).rejects.toMatchObject({
        stdout: expect.not.stringContaining(secret),
        stderr: expect.not.stringContaining(secret),
      });
    } finally {
      connection?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});

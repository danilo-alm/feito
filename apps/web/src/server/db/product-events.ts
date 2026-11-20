import "server-only";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { databaseUrl } from "@/server/crypto/config";

type Subscriber = { changed(): void; disconnected(): void };

export function createProductEvents() {
  let connection: { client: Client; ready: Promise<void> } | undefined;
  const subscribers = new Map<string, Set<Subscriber>>();

  async function listen() {
    if (!connection) {
      const client = new Client({
        connectionString: databaseUrl("DOMAIN_DATABASE_URL"),
        connectionTimeoutMillis: 5_000,
        statement_timeout: 5_000,
        keepAlive: true,
      });
      function disconnected() {
        if (connection?.client !== client) return;
        connection = undefined;
        for (const group of subscribers.values()) {
          for (const subscriber of group) subscriber.disconnected();
        }
        subscribers.clear();
        void client.end().catch(() => undefined);
      }

      client.on("error", disconnected);
      client.on("end", disconnected);
      client.on("notification", ({ payload }) => {
        if (connection?.client !== client || !payload) return;
        for (const subscriber of subscribers.get(payload) ?? []) subscriber.changed();
      });
      const ready = client.connect().then(async () => { await client.query("LISTEN feito_product_revision"); });
      connection = { client, ready };
      void ready.catch(disconnected);
    }
    const current = connection;
    await current.ready;
    if (connection !== current) throw new Error("Canal de mudanças indisponível.");
  }

  return {
    listen,
    subscribe(tenantId: string, subscriber: Subscriber) {
      const key = createHash("sha256").update(tenantId).digest("hex");
      const group = subscribers.get(key) ?? new Set<Subscriber>();
      group.add(subscriber);
      subscribers.set(key, group);
      return () => {
        group.delete(subscriber);
        if (!group.size && subscribers.get(key) === group) subscribers.delete(key);
      };
    },
    async close() {
      await connection?.client.end();
    },
  };
}

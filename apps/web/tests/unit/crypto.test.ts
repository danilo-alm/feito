import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readKeyConfig, secret } from "@/server/crypto/config";
import { CipherError, openPayload, sealPayload, unwrapDek, wrapDek } from "@/server/crypto/envelope";
import type { PayloadContext } from "@/server/crypto/envelope";

function configuration() {
  return {
    DATA_KEK_ACTIVE_VERSION: "1",
    DATA_KEK_V1: randomBytes(32).toString("base64"),
  };
}

describe("configuration", () => {
  it("rejects missing, invalid or duplicate key material", () => {
    const env = configuration();
    expect(() => readKeyConfig({ ...env, DATA_KEK_V1: "" })).toThrow("DATA_KEK_V1");
    expect(() => readKeyConfig({ ...env, DATA_KEK_V1: "invalid" })).toThrow("DATA_KEK_V1");
    expect(() => readKeyConfig({ ...env, DATA_KEK_V2: env.DATA_KEK_V1 })).toThrow("DATA_KEK_V2");
    expect(() => readKeyConfig({ ...env, DATA_KEK_ACTIVE_VERSION: "2" })).toThrow("DATA_KEK_V2");
  });

  it("uses the secrets directory exclusively when configured", () => {
    const path = mkdtempSync(join(tmpdir(), "feito-test-secrets-"));
    try {
      const env = configuration();
      writeFileSync(join(path, "DATA_KEK_V1"), env.DATA_KEK_V1 + "\n", { mode: 0o600 });
      expect(readKeyConfig({ ...env, DATA_KEK_V1: "", APP_SECRETS_DIR: path }).activeVersion).toBe(1);
      expect(() => readKeyConfig({ ...env, APP_SECRETS_DIR: path })).toThrow("DATA_KEK_V");
      expect(() => secret("BETTER_AUTH_SECRET", { APP_SECRETS_DIR: path })).toThrow("BETTER_AUTH_SECRET");
    } finally {
      rmSync(path, { recursive: true });
    }
  });
});

describe("AES-256-GCM envelope", () => {
  it("authenticates the tenant and both key versions using the configured KEK", () => {
    const config = readKeyConfig(configuration());
    const dek = randomBytes(32);
    const metadata = { tenantId: randomUUID(), version: 1, kekVersion: 1 };
    const envelope = { ...metadata, ...wrapDek(config, metadata, dek) };
    expect(unwrapDek(config, envelope)).toEqual(dek);
    expect(wrapDek(config, metadata, dek).nonce).not.toEqual(envelope.nonce);
    expect(() => unwrapDek(readKeyConfig(configuration()), envelope)).toThrow(CipherError);
    for (const altered of [{ tenantId: randomUUID() }, { version: 2 }, { kekVersion: 2 }, { tag: randomBytes(16) }]) {
      expect(() => unwrapDek(config, { ...envelope, ...altered })).toThrow(CipherError);
    }
  });

  it("allows rewrapping under another KEK without changing a payload", () => {
    const env = configuration();
    const config = readKeyConfig({ ...env, DATA_KEK_ACTIVE_VERSION: "2", DATA_KEK_V2: randomBytes(32).toString("base64") });
    const original = { tenantId: randomUUID(), version: 1, kekVersion: 1 };
    const dek = randomBytes(32);
    const sealed = { ...original, ...wrapDek(config, original, dek) };
    const next = { ...original, kekVersion: config.activeVersion };
    const rewrapped = { ...next, ...wrapDek(config, next, unwrapDek(config, sealed)) };
    expect(unwrapDek(config, rewrapped)).toEqual(dek);
  });

  it("authenticates payload identity, relationships, versions, revision and ciphertext", () => {
    const dek = randomBytes(32);
    const ctx: PayloadContext = {
      tenantId: randomUUID(), type: "task", id: randomUUID(),
      dekVersion: 1, payloadVersion: 2, revision: 1, links: [randomUUID()],
    };
    const payload = { title: "Tarefa sintética" };
    const sealed = sealPayload(dek, ctx, payload);
    expect(openPayload(dek, ctx, sealed)).toEqual(payload);
    expect(sealPayload(dek, ctx, payload).nonce).not.toEqual(sealed.nonce);

    const changes: Partial<PayloadContext>[] = [
      { tenantId: randomUUID() }, { type: "project" }, { id: randomUUID() }, { links: [randomUUID()] },
      { dekVersion: 2 }, { payloadVersion: 1 }, { revision: 2 },
    ];
    for (const changed of changes) {
      expect(() => openPayload(dek, { ...ctx, ...changed }, sealed)).toThrow(CipherError);
    }
    const ciphertext = Buffer.from(sealed.ciphertext);
    ciphertext[0] ^= 1;
    expect(() => openPayload(dek, ctx, { ...sealed, ciphertext })).toThrow(CipherError);
  });
});

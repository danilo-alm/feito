import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyConfig } from "./config";

export const MAX_INVOCATIONS = 2 ** 24 - 1;

export type Ciphertext = { nonce: Buffer; tag: Buffer; ciphertext: Buffer };
type AadValue = string | number | boolean | null;

export class CipherError extends Error {}

function seal(key: Buffer, plaintext: Buffer, aad: readonly AadValue[]): Ciphertext {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(JSON.stringify(aad)));
  return {
    nonce,
    ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]),
    tag: cipher.getAuthTag(),
  };
}

function open(key: Buffer, sealed: Ciphertext, aad: readonly AadValue[]): Buffer {
  if (sealed.nonce.length !== 12 || sealed.tag.length !== 16) throw new CipherError();
  let unverified: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.nonce, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(JSON.stringify(aad)));
    decipher.setAuthTag(sealed.tag);
    unverified = decipher.update(sealed.ciphertext);
    decipher.final(); // Authenticate before handing off the plaintext.
    return unverified;
  } catch {
    unverified?.fill(0);
    throw new CipherError();
  }
}

type EnvelopeContext = { tenantId: string; version: number; kekVersion: number };

function envelopeAad(config: KeyConfig, envelope: EnvelopeContext) {
  return ["feito:dek", config.installationId, envelope.tenantId, envelope.version, envelope.kekVersion];
}

export function wrapDek(config: KeyConfig, envelope: EnvelopeContext, dek: Buffer) {
  const kek = config.keys.get(envelope.kekVersion);
  if (!kek || dek.length !== 32) throw new CipherError();
  return seal(kek, dek, envelopeAad(config, envelope));
}

export function unwrapDek(config: KeyConfig, envelope: EnvelopeContext & Ciphertext): Buffer {
  const kek = config.keys.get(envelope.kekVersion);
  if (!kek || envelope.ciphertext.length !== 32) throw new CipherError();
  return open(kek, envelope, envelopeAad(config, envelope));
}

export type PayloadContext = {
  tenantId: string;
  type: "preferences" | "project" | "task";
  id: string;
  dekVersion: number;
  payloadVersion: number;
  revision: number;
  links: readonly AadValue[];
};

function payloadAad(installationId: string, ctx: PayloadContext) {
  return [
    "feito:payload", installationId, ctx.tenantId, ctx.type, ctx.id,
    ctx.dekVersion, ctx.payloadVersion, ctx.revision, ...ctx.links,
  ];
}

export function sealPayload(installationId: string, dek: Buffer, ctx: PayloadContext, value: object) {
  const bytes = Buffer.from(JSON.stringify(value));
  try {
    return seal(dek, bytes, payloadAad(installationId, ctx));
  } finally {
    bytes.fill(0);
  }
}

export function openPayload(
  installationId: string, dek: Buffer, ctx: PayloadContext, sealed: Ciphertext,
): unknown {
  const bytes = open(dek, sealed, payloadAad(installationId, ctx));
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new CipherError();
  } finally {
    bytes.fill(0);
  }
}

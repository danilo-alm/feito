import "server-only";
import { hash, verify } from "@node-rs/argon2";

export const hashPassword = (password: string) => hash(password, {
  algorithm: 2, // Argon2id in @node-rs/argon2
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
});

export const verifyPassword = (digest: string, password: string) => verify(digest, password);

import { z } from "zod";

// Minimal avulsa record used by the encrypted storage foundation.
export const taskPayload = z.strictObject({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  position: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export type TaskPayload = z.infer<typeof taskPayload>;

import { z } from "zod";

export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const suppliedPassword = z.string().min(1).max(256)
  .refine((value) => value.isWellFormed() && [...value].length <= 128);

export const loginInput = z.strictObject({ email, password: suppliedPassword });
export const changePasswordInput = z.strictObject({
  currentPassword: suppliedPassword,
  newPassword: z.string(),
});

export const validNewPassword = z.string().refine((value) => {
  const length = [...value].length;
  return length >= 5 && length <= 128 && value.isWellFormed();
});

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
  return length >= 15 && length <= 128 && value.isWellFormed();
});

const timezone = z.string().min(1).max(128).refine((value) => {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
});

export const preferences = z.strictObject({ timezone, theme: z.enum(["light", "dark", "system"]) });
export const preferencesPatch = preferences.partial();
export type Preferences = z.infer<typeof preferences>;

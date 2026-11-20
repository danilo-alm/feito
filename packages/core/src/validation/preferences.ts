import { z } from "zod";

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

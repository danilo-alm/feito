import { z } from "zod";
import { ACCENTS, DARK_THEMES, isHexAccent, LIGHT_THEMES, type HexAccent, type Locale } from "../types";

const timezone = z.string().min(1).max(128).refine((value) => {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
});

// Novos idiomas entram só no fim da lista; documentos sem `locale` usam o idioma padrão.
export const locales = ["pt-BR", "pt-PT", "en", "es", "fr", "it", "de"] as const satisfies readonly Locale[];
// Layout das agendas Hoje e Em breve; ausente, vale a Lista.
const agendaLayout = z.enum(["list", "board", "calendar", "table"]).optional();
const accent = z.union([z.enum(ACCENTS), z.custom<HexAccent>(isHexAccent).transform((value) => value.toLowerCase() as HexAccent)]);
export const preferences = z.strictObject({
  timezone, theme: z.enum(["light", "dark", "system"]), locale: z.enum(locales).optional(),
  todayLayout: agendaLayout, upcomingLayout: agendaLayout,
  lightTheme: z.enum(LIGHT_THEMES).optional(), darkTheme: z.enum(DARK_THEMES).optional(), accent: accent.optional(),
  todayTimeline: z.boolean().optional(),
});
export const preferencesPatch = preferences.partial();
export type Preferences = z.infer<typeof preferences>;

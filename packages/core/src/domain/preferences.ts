import { Temporal } from "@js-temporal/polyfill";

export const defaultPreferences = { timezone: "America/Maceio", theme: "system" } as const;

export function referenceDate(timezone: string, now = Temporal.Now.instant()): string {
  return now.toZonedDateTimeISO(timezone).toPlainDate().toString();
}

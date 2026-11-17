import { Temporal } from "@js-temporal/polyfill";
import type { RecurrenceRule } from "@/validation/product";

export function nextOccurrenceDate(
  rule: RecurrenceRule, effectiveDate: string, completionDate: string,
): string {
  const anchor = Temporal.PlainDate.from(rule.anchorDate);
  // These strings use the canonical, fixed-width ISO date representation.
  const threshold = Temporal.PlainDate.from([rule.nominalDate, effectiveDate, completionDate].sort().at(-1)!);

  if (rule.frequency === "daily") return threshold.add({ days: 1 }).toString();
  if (rule.frequency === "weekly") {
    const daysSinceAnchor = anchor.until(threshold, { largestUnit: "days" }).days;
    return anchor.add({ weeks: Math.floor(daysSinceAnchor / 7) + 1 }).toString();
  }

  const monthsSinceAnchor = (threshold.year - anchor.year) * 12 + threshold.month - anchor.month;
  const candidate = anchor.add({ months: monthsSinceAnchor });
  return (Temporal.PlainDate.compare(candidate, threshold) > 0
    ? candidate
    : anchor.add({ months: monthsSinceAnchor + 1 })).toString();
}

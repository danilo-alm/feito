import { describe, expect, it } from "vitest";
import { nextOccurrenceDate } from "@feito/core/domain/recurrence";
import type { RecurrenceRule } from "@feito/core/validation/product";

const rule = (frequency: RecurrenceRule["frequency"], anchorDate: string, nominalDate = anchorDate): RecurrenceRule =>
  ({ frequency, anchorDate, nominalDate, time: null });

describe("anchored recurrence", () => {
  it("advances a daily task beyond the local completion date or a later effective date", () => {
    expect(nextOccurrenceDate(rule("daily", "2026-11-16"), "2026-11-16", "2026-11-17")).toBe("2026-11-18");
    expect(nextOccurrenceDate(rule("daily", "2026-11-16"), "2026-11-22", "2026-11-17")).toBe("2026-11-23");
  });

  it("does not reopen the nominal Monday after early completion on Sunday", () => {
    expect(nextOccurrenceDate(rule("weekly", "2026-11-16"), "2026-11-15", "2026-11-15")).toBe("2026-11-23");
    expect(nextOccurrenceDate(rule("weekly", "2026-11-16"), "2026-12-08", "2026-11-25")).toBe("2026-12-14");
  });

  it("preserves the monthly anchor across February in common and leap years", () => {
    for (const [year, day] of [[2027, 28], [2028, 29]]) {
      const january = `${year}-01-31`;
      const february = `${year}-02-${day}`;
      expect(nextOccurrenceDate(rule("monthly", january), january, january)).toBe(february);
      expect(nextOccurrenceDate(rule("monthly", january, february), february, february)).toBe(`${year}-03-31`);
    }
  });

  it("uses a later nominal day within the threshold month when available", () => {
    expect(nextOccurrenceDate(rule("monthly", "2027-01-31"), "2027-03-04", "2027-03-25")).toBe("2027-03-31");
    expect(nextOccurrenceDate(rule("monthly", "2027-01-31"), "2027-03-04", "2027-03-31")).toBe("2027-04-30");
  });
});

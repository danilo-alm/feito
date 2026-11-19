import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { referenceDate } from "@/domain/preferences";
import { preferencesPatch, validNewPassword } from "@/validation/account";

describe("preferences and identity validation", () => {
  it("computes today at the account's midnight", () => {
    const now = Temporal.Instant.from("2026-11-17T02:59:59Z");
    expect(referenceDate("America/Maceio", now)).toBe("2026-11-16");
    expect(referenceDate("UTC", now)).toBe("2026-11-17");
    expect(referenceDate("America/Maceio", now.add({ seconds: 1 }))).toBe("2026-11-17");
  });

  it("accepts IANA zones and rejects offsets and extraneous fields", () => {
    expect(preferencesPatch.safeParse({ timezone: "America/Sao_Paulo", theme: "dark" }).success).toBe(true);
    for (const patch of [{ timezone: "+03:00" }, { timezone: "Mars/Olympus" }, { tenantId: "other" }, { theme: null }]) {
      expect(preferencesPatch.safeParse(patch).success).toBe(false);
    }
  });

  it("counts Unicode characters without trimming passwords", () => {
    expect(validNewPassword.safeParse("🦉".repeat(128)).success).toBe(true);
    expect(validNewPassword.safeParse("🦉".repeat(129)).success).toBe(false);
    expect(validNewPassword.safeParse("a".repeat(4) + " ").success).toBe(true);
    expect(validNewPassword.safeParse("a".repeat(4)).success).toBe(false);
  });
});

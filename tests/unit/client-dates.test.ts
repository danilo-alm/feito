import { describe, expect, it } from "vitest";
import { daysInMonth, monthStart, parseDueInput } from "@/client/dates";

// Quinta-feira, 19 de novembro de 2026.
const REF = "2026-11-19";

describe("parseDueInput", () => {
  it.each([
    ["hoje", "2026-11-19"],
    ["Amanhã", "2026-11-20"],
    ["fim de semana", "2026-11-21"],
    ["próxima semana", "2026-11-23"],
    ["sexta", "2026-11-20"],
    ["quinta-feira", "2026-11-26"],
    ["em 3 dias", "2026-11-22"],
    ["25/12", "2026-12-25"],
    ["10/1", "2027-01-10"],
    ["1/2/28", "2028-02-01"],
    ["25 dez", "2026-12-25"],
    ["5 de março", "2027-03-05"],
    ["jan 4 2028", "2028-01-04"],
    ["2027-01-04", "2027-01-04"],
  ])("%s → %s", (input, expected) => {
    expect(parseDueInput(input, REF)).toBe(expected);
  });

  it.each(["", "banana", "31/02", "32 dez", "13/13"])("rejeita %j", (input) => {
    expect(parseDueInput(input, REF)).toBeNull();
  });
});

describe("month helpers", () => {
  it("steps across years", () => {
    expect(monthStart(REF)).toBe("2026-11-01");
    expect(monthStart(REF, 2)).toBe("2027-01-01");
    expect(monthStart(REF, -11)).toBe("2025-12-01");
    expect(daysInMonth("2028-02-01")).toBe(29);
  });
});

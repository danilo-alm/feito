import { describe, expect, it } from "vitest";
import { nextPresence, parseDuration, type PresenceEvent, type PresenceState } from "@feito/ui/client/presence";

const run = (events: PresenceEvent[], start: PresenceState = "unmounted", instantExit = false) =>
  events.reduce<PresenceState>((state, event) => nextPresence(state, event, { instantExit }), start);

describe("presença", () => {
  it("abre, assenta, sai e só então desmonta", () => {
    expect(run(["open"])).toBe("entering");
    expect(run(["open", "settled"])).toBe("entered");
    expect(run(["open", "settled", "close"])).toBe("exiting");
    expect(run(["open", "settled", "close", "settled"])).toBe("unmounted");
  });

  it("reabrir durante a saída reaproveita o mesmo nó, sem desmontar", () => {
    expect(run(["open", "settled", "close", "open"])).toBe("entering");
    expect(run(["open", "close", "open", "close", "open", "settled"])).toBe("entered");
  });

  it("abrir de novo quando já está aberto não reinicia a entrada", () => {
    expect(run(["open", "settled", "open"])).toBe("entered");
  });

  it("fechar sem estar montado não faz nada; um timeout atrasado não reabre", () => {
    expect(run(["close"])).toBe("unmounted");
    expect(run(["settled"])).toBe("unmounted");
    expect(run(["open", "settled", "settled"])).toBe("entered");
  });

  it("com movimento reduzido desmonta na hora, sem depender de transitionend", () => {
    expect(run(["open", "close"], "unmounted", true)).toBe("unmounted");
    expect(run(["open", "settled", "close"], "unmounted", true)).toBe("unmounted");
  });

  it("lê durações do CSS em ms ou s", () => {
    expect(parseDuration(" 180ms", 0)).toBe(180);
    expect(parseDuration(".26s", 0)).toBe(260);
    expect(parseDuration("", 120)).toBe(120);
  });
});

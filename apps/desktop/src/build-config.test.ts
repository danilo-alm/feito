import { describe, expect, it, vi } from "vitest";
import config from "../vite.config";

describe("avisos do build desktop", () => {
  const onLog = config.build!.rolldownOptions!.onLog!;

  it("ignora a diretiva use client no bundle inteiramente cliente", () => {
    const handler = vi.fn();
    onLog("warn", {
      code: "MODULE_LEVEL_DIRECTIVE",
      message: 'The semantics of the module level directive "use client" may not be preserved when bundling.',
    }, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserva outros avisos e níveis de log", () => {
    const handler = vi.fn();
    const serverDirective = { code: "MODULE_LEVEL_DIRECTIVE", message: 'Directive "use server"' };
    const otherWarning = { code: "OTHER_WARNING", message: 'Warning about "use client"' };
    const info = { code: "MODULE_LEVEL_DIRECTIVE", message: 'Directive "use client"' };

    onLog("warn", serverDirective, handler);
    onLog("warn", otherWarning, handler);
    onLog("info", info, handler);

    expect(handler.mock.calls).toEqual([
      ["warn", serverDirective],
      ["warn", otherWarning],
      ["info", info],
    ]);
  });
});

import { expect } from "@playwright/test";
import { newWorkspace } from "../../../desktop/src/data/local";
import { mockDesktop, test } from "./fixtures";

for (const narrow of [false, true]) {
  test(`idioma compartilhado em janela ${narrow ? "estreita" : "ampla"}`, async ({ page }) => {
    await page.setViewportSize({ width: narrow ? 390 : 1180, height: 844 });
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: newWorkspace() } });
    // O cofre simulado sobrevive ao reload, tal como o armazenamento nativo.
    await page.addInitScript(() => {
      const native = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      const invoke = native.invoke;
      native.invoke = async (command, args) => {
        if (command === "read_workspace") {
          const stored = sessionStorage.getItem("test:native-workspace");
          return stored ? JSON.parse(stored) : invoke(command, args);
        }
        if (command === "write_workspace") {
          const next = args as { generation: number; value: unknown };
          const stored = { generation: next.generation + 1, value: next.value };
          sessionStorage.setItem("test:native-workspace", JSON.stringify(stored));
          return stored;
        }
        return invoke(command, args);
      };
    });
    await page.goto("/#/ajustes");
    const picker = page.getByRole("button", { name: "Idioma", exact: true });
    await picker.click();
    await expect(page.getByRole("option", { name: "Português (Brasil)", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "Português (Portugal)", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "English", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Language", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "Language", exact: true })).toContainText("English");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await page.screenshot({ path: `/tmp/feito-language-${narrow ? "mobile" : "desktop"}.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: `/tmp/feito-language-dark-${narrow ? "mobile" : "desktop"}.png`, fullPage: true });
    await page.getByRole("button", { name: "Language", exact: true }).click();
    // Todos os idiomas aparecem com o próprio nome, na mesma lista.
    await expect(page.getByRole("option")).toHaveText([
      "Português (Brasil)", "Português (Portugal)", "English", "Español", "Français", "Italiano", "Deutsch",
    ]);
    await page.getByRole("option", { name: "Deutsch", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("heading", { name: "Darstellung", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sprache", exact: true })).toContainText("Deutsch");
    await page.screenshot({ path: `/tmp/feito-language-de-dark-${narrow ? "mobile" : "desktop"}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.getByRole("button", { name: "Sprache", exact: true }).click();
    await page.getByRole("option", { name: "Español", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Apariencia", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Idioma", exact: true }).click();
    await page.getByRole("option", { name: "Português (Brasil)", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("heading", { name: "Aparência", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

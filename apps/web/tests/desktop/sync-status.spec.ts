import { expect } from "@playwright/test";
import { newWorkspace } from "../../../desktop/src/data/local";
import { mockDesktop, test } from "./fixtures";

for (const narrow of [false, true]) {
  test(`oculta o indicador em janela ${narrow ? "estreita" : "ampla"}`, async ({ page }) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = newWorkspace();
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "server", server: {
      origin: "https://feito.example", user: { id: "b1fa8244-3300-4383-abb7-80fd5216a6fb", email: "ana@example.test" },
      confirmed: workspace, working: workspace, pending: [], cursor: 0,
    } } });
    await page.goto("/#/ajustes");
    const toggle = page.getByRole("switch", { name: "Mostrar indicador de sincronização", exact: true });
    const indicator = page.locator(".sync-status");
    await expect(toggle).toBeChecked();
    await expect(indicator).toBeVisible();
    await toggle.click();
    await expect(indicator).toHaveCount(0);
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await expect(indicator).toHaveCount(0);
    await toggle.focus();
    await toggle.press("Space");
    await expect(toggle).toBeChecked();
    await expect(indicator).toBeVisible();
    await page.screenshot({ path: `/tmp/feito-sync-setting-${narrow ? "narrow" : "wide"}.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: `/tmp/feito-sync-setting-dark-${narrow ? "narrow" : "wide"}.png`, fullPage: true });
  });
}

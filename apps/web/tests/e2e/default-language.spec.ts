import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("opens in English by default and preserves an explicit language choice", async ({ page, isMobile }) => {
  await page.goto("/entrar");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Sign in to Feito" })).toBeVisible();
  await page.getByRole("button", { name: "Use in this browser without an account" }).click();
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await page.goto("/ajustes");
  await expect(page.getByRole("button", { name: "Language", exact: true })).toContainText("English");
  await page.screenshot({ path: `/tmp/feito-default-english-web-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: `/tmp/feito-default-english-web-dark-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await expect(page.getByRole("option", { name: "English", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("option", { name: "Português (Brasil)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Idioma", exact: true })).toContainText("Português (Brasil)");
  await expect(page.getByRole("button", { name: "Idioma", exact: true })).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByRole("button", { name: "Idioma", exact: true })).toContainText("Português (Brasil)");
});

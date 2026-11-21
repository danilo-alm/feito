import { expect, test } from "@playwright/test";

test("troca o idioma, preserva textos pessoais e reabre em inglês offline", async ({ page, context, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Usar neste navegador, sem conta" }).click();
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  await page.goto("/ajustes");
  await expect(page.getByRole("region", { name: "Acesso offline" }).getByRole("status"))
    .toHaveText("Pronto para uso offline neste navegador.", { timeout: 25_000 });
  await page.getByRole("button", { name: "Idioma", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
  await page.goto("/entrada");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  if (isMobile) await page.locator("button[aria-label='Add task']").click();
  else await page.keyboard.press("q");
  const editor = page.getByRole("dialog", { name: "Add task", exact: true });
  await editor.getByLabel("Task title").fill("Hoje, café e organização");
  await editor.getByLabel("Task title").press("Enter");
  await expect(page.getByText(/Task added to/)).toBeVisible();
  await expect(page.getByText("Hoje, café e organização", { exact: true })).toBeVisible();
  await page.goto("/ajustes");
  await page.screenshot({ path: `/tmp/feito-web-language-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: `/tmp/feito-web-language-dark-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Language", exact: true })).toContainText("English");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "Português (Brasil)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aparência", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

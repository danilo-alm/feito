import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

async function openSettings(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Use in this browser without an account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await page.goto("/ajustes");
  await expect(page.getByRole("button", { name: "Language", exact: true })).toContainText("English");
}

test.describe("catálogos sob demanda", () => {
  test.use({ serviceWorkers: "block" });

  test("adia o catálogo e preserva o rascunho enquanto o idioma carrega", async ({ page, isMobile }) => {
    const scripts = new Set<string>();
    page.on("request", (request) => { if (request.resourceType() === "script") scripts.add(request.url()); });
    await openSettings(page);
    const initial = new Set(scripts);
    const requested = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await page.route("**/_next/static/chunks/*.js", async (route) => {
      requested.resolve();
      await release.promise;
      await route.continue();
    });
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("option", { name: "Deutsch", exact: true }).click();
    try {
      await requested.promise;
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.getByRole("button", { name: "Language", exact: true })).toHaveAttribute("aria-busy", "true");
      expect(await page.evaluate(() => localStorage.getItem("feito:locale"))).toBe("en");
      expect([...scripts].some((url) => !initial.has(url))).toBe(true);
      if (isMobile) await page.getByRole("button", { name: "Add task", exact: true }).click();
      else await page.keyboard.press("q");
      const title = page.getByRole("dialog").getByRole("textbox").first();
      await title.fill("Hoje, café e organização");
      release.resolve();
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
      await expect(title).toHaveValue("Hoje, café e organização");
      await expect(title).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("heading", { name: "Darstellung", exact: true })).toBeVisible();
    } finally {
      release.resolve();
    }
  });

  test("não grava um idioma cujo catálogo falhou e permite tentar novamente", async ({ page }) => {
    await openSettings(page);
    await page.route("**/_next/static/chunks/*.js", (route) => route.abort());
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("option", { name: "Deutsch", exact: true }).click();
    await expect(page.getByText("Could not complete the operation.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Language", exact: true })).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(await page.evaluate(() => localStorage.getItem("feito:locale"))).toBe("en");
    await page.unroute("**/_next/static/chunks/*.js");
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("option", { name: "Deutsch", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Darstellung", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Darstellung", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  });
});

test("abre pela primeira vez todos os catálogos sem rede e restaura o idioma após recarregar", async ({ page, context }) => {
  await openSettings(page);
  await expect(page.getByRole("status").filter({ hasText: "Ready for offline use in this browser." })).toBeVisible({ timeout: 25_000 });
  const offlineScripts = new Set<string>();
  page.on("response", (response) => {
    if (response.request().resourceType() === "script" && response.fromServiceWorker()) offlineScripts.add(response.url());
  });
  await context.setOffline(true);
  for (const [name, locale] of [["Deutsch", "de"], ["Français", "fr"], ["Español", "es"], ["Italiano", "it"], ["Português (Portugal)", "pt-PT"]]) {
    await page.locator("#language").click();
    await page.getByRole("option", { name, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
  expect(offlineScripts.size).toBeGreaterThanOrEqual(5);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-PT");
  await expect(page.locator("#language")).toContainText("Português (Portugal)");
});

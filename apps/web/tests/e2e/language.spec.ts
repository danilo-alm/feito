import { expect, test } from "@playwright/test";

test.describe("rolagem do menu de idiomas", () => {
  test.skip(({ isMobile }) => !isMobile, "Somente no perfil de celular");

  test("mantém a página parada com uma lista curta ou no limite da lista", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByRole("button", { name: "Usar neste navegador, sem conta" }).click();
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
    await page.goto("/ajustes");
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (x: number, y: number, distance = -160) => {
      await cdp.send("Input.synthesizeScrollGesture", {
        x, y, yDistance: distance, gestureSourceType: "touch", preventFling: true,
      });
    };
    const scrollY = () => page.evaluate(() => window.scrollY);
    const picker = page.getByRole("button", { name: "Idioma", exact: true });
    await picker.click();
    const dialog = page.getByRole("dialog", { name: "Idioma" });
    const list = dialog.getByRole("listbox");
    await expect(list.getByRole("option").last()).toBeInViewport();
    expect(await dialog.evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(0);
    const before = await scrollY();
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(before);
    const box = (await list.boundingBox())!;
    await swipe(box.x + box.width / 2, box.y + box.height - 20);
    expect(await scrollY()).toBe(before);

    await page.setViewportSize({ width: 390, height: 300 });
    const shortBox = (await dialog.boundingBox())!;
    const bottom = shortBox.y + shortBox.height - 25;
    const scrollTop = () => dialog.evaluate((node) => node.scrollTop);
    const extent = await dialog.evaluate((node) => node.scrollHeight - node.clientHeight);
    expect(extent).toBeGreaterThan(0);
    const shortBefore = await scrollY();
    await swipe(shortBox.x + shortBox.width / 2, bottom, -(extent + 32));
    await expect.poll(scrollTop).toBe(extent);
    await swipe(shortBox.x + shortBox.width / 2, bottom);
    expect(await scrollY()).toBe(shortBefore);

    await dialog.getByRole("button", { name: "Fechar (Esc)" }).click();
    await expect(dialog).toHaveCount(0);
    const afterClose = await scrollY();
    await swipe(195, 230);
    await expect.poll(scrollY).toBeGreaterThan(afterClose);
    await cdp.detach();
  });
});

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

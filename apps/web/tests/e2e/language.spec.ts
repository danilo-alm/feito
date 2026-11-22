import { openPortugueseLocalWorkspace } from "./fixtures";
import { expect, test, type Page } from "@playwright/test";

async function swipeUp(page: Page, x: number, y: number, distance = 160) {
  const cdp = await page.context().newCDPSession(page);
  const touchPoints = (touchY: number) => [{ x, y: touchY }];
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoints(y) });
    const steps = 10;
    for (let step = 1; step <= steps; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: touchPoints(y - (distance * step) / steps),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

async function openLanguageDialog(page: Page) {
  await page.goto("/entrar");
  await openPortugueseLocalWorkspace(page);
  await page.goto("/ajustes");
  await page.getByRole("button", { name: "Idioma", exact: true }).click();
  return page.getByRole("dialog", { name: "Idioma" });
}

function scrollY(page: Page) {
  return page.evaluate(() => window.scrollY);
}

test.describe("rolagem do menu de idiomas", () => {
  test.skip(({ isMobile }) => !isMobile, "Somente no perfil de celular");

  test("mantém a página parada com uma lista curta", async ({ page }) => {
    const dialog = await openLanguageDialog(page);
    const list = dialog.getByRole("listbox");
    await expect(list.getByRole("option").last()).toBeInViewport();
    expect(await dialog.evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(0);
    const before = await scrollY(page);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(before);
    const box = (await list.boundingBox())!;
    await swipeUp(page, box.x + box.width / 2, box.y + box.height - 20);
    expect(await scrollY(page)).toBe(before);
  });

  test("rola o diálogo sem mover a página no limite da lista", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 300 });
    const dialog = await openLanguageDialog(page);
    await expect(dialog).toBeVisible();
    const dialogBox = (await dialog.boundingBox())!;
    const listBox = (await dialog.getByRole("listbox").boundingBox())!;
    const x = listBox.x + listBox.width / 2;
    const y = Math.min(listBox.y + listBox.height, dialogBox.y + dialogBox.height) - 20;
    const scrollTop = () => dialog.evaluate((node) => node.scrollTop);
    const extent = await dialog.evaluate((node) => node.scrollHeight - node.clientHeight);
    expect(extent).toBeGreaterThan(0);
    const before = await scrollY(page);
    await swipeUp(page, x, y);
    await expect.poll(scrollTop).toBe(extent);
    await swipeUp(page, x, y);
    expect(await scrollY(page)).toBe(before);

    await dialog.getByRole("button", { name: "Fechar (Esc)" }).click();
    await expect(dialog).toHaveCount(0);
    const afterClose = await scrollY(page);
    await swipeUp(page, 195, 230);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(afterClose);
  });
});

test("troca o idioma, preserva textos pessoais e reabre em inglês offline", async ({ page, context, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/entrar");
  await openPortugueseLocalWorkspace(page);
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

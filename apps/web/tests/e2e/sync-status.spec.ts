import { expect, test } from "./fixtures";

test("permite esconder o indicador e mantém a escolha ao recarregar", async ({ page }) => {
  await page.goto("/ajustes");
  const toggle = page.getByRole("switch", { name: "Mostrar indicador de sincronização", exact: true });
  const indicator = page.locator(".sync-status");
  await expect(toggle).toBeChecked();
  await expect(indicator).toBeVisible();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(indicator).toHaveCount(0);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(indicator).toHaveCount(0);
  await toggle.focus();
  await toggle.press("Space");
  await expect(toggle).toBeChecked();
  await expect(indicator).toBeVisible();
});

test("indicador mostra só a bolinha e revela o estado ao receber foco", async ({ page, isMobile }) => {
  await page.goto("/hoje");
  const indicator = page.getByRole("link", { name: "Sincronizado. Abrir ajustes", exact: true });
  const label = indicator.locator("span");
  const appBackground = await page.locator("html").evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveCSS("width", "24px");
  await expect(indicator).toHaveCSS("height", "24px");
  await expect(label).toHaveCSS("opacity", "0");
  if (isMobile) {
    await expect(indicator).toHaveCSS("left", "8px");
    const tabbar = page.getByRole("navigation", { name: "Navegação", exact: true });
    const tabbarBox = (await tabbar.boundingBox())!;
    const indicatorBox = (await indicator.boundingBox())!;
    expect(tabbarBox.y - (indicatorBox.y + indicatorBox.height)).toBe(indicatorBox.x);
    await expect(indicator).toHaveCSS("background-color", appBackground);
    await expect(indicator).toHaveCSS("border-radius", "50%");
  } else {
    await expect(indicator).toHaveCSS("right", "8px");
    await expect(indicator).toHaveCSS("bottom", "8px");
  }
  await indicator.focus();
  await expect(label).toHaveCSS("opacity", "1");
  await expect(label).toHaveCSS("background-color", appBackground);
  await expect(label).toHaveCSS("padding", "4px 10px");
  await expect(label).toHaveCSS("border-radius", "999px");
  await indicator.press("Enter");
  await expect(page).toHaveURL(/\/ajustes#sincronizacao$/);
});

test("indicador revela o estado no hover", async ({ page, isMobile }) => {
  test.skip(isMobile, "O celular usa toque e foco em vez de hover.");
  await page.goto("/hoje");
  const indicator = page.getByRole("link", { name: "Sincronizado. Abrir ajustes", exact: true });
  await indicator.hover();
  await expect(indicator.locator("span")).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await expect(indicator.locator("span")).toHaveCSS("opacity", "0");
});

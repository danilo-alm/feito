import { expect } from "@playwright/test";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

test.use({ hasTouch: true });

for (const shortcuts of [false, true]) {
  test(`toda a linha destacada abre o projeto ${shortcuts ? "com" : "sem"} atalhos`, async ({ page }) => {
    const workspace = newPortugueseWorkspace();
    const project = { ...workspace.projects[0], id: crypto.randomUUID(), isInbox: false,
      data: { ...workspace.projects[0].data, name: "Projeto de navegação" } };
    workspace.projects.push(project);
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
    await page.goto("/#/hoje");
    const row = page.locator(".proj-row").filter({ hasText: project.data.name });
    await expect(row).toBeVisible();
    const bounds = (await row.boundingBox())!;
    // Bordas laterais, faixas acima/abaixo do texto e espaço do atalho.
    const points = [
      { x: 2, y: bounds.height / 2 },
      { x: bounds.width / 2, y: 2 },
      { x: bounds.width / 2, y: bounds.height - 2 },
      { x: bounds.width - 2, y: bounds.height / 2 },
      ...(shortcuts ? [{ x: bounds.width - 22, y: bounds.height / 2 }] : []),
    ];
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const point of points) {
        if (shortcuts) {
          await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true })));
          await expect(row.locator(".project-shortcut")).toBeVisible();
        }
        await page.mouse.move(bounds.x + point.x, bounds.y + point.y);
        await expect(row).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
        await expect(page).toHaveURL(new RegExp(`/projetos/${project.id}$`));
        await page.goto("/#/hoje");
      }
      await row.hover();
      await page.screenshot({ path: test.info().outputPath(`sidebar-${colorScheme}.png`) });
    }
    if (!shortcuts) {
      await row.hover();
      await row.getByRole("button", { name: `Ações de ${project.data.name}` }).click();
      await expect(page.getByRole("menuitem", { name: "Editar projeto", exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/hoje$/);
      await page.keyboard.press("Escape");
    }
    const link = row.getByRole("link", { name: project.data.name });
    await link.focus();
    await link.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/projetos/${project.id}$`));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/navegar");
    await page.screenshot({ path: test.info().outputPath("mobile-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: test.info().outputPath("mobile-light.png") });
    await page.getByRole("link", { name: new RegExp(project.data.name) }).tap();
    await expect(page).toHaveURL(new RegExp(`/projetos/${project.id}$`));
  });
}

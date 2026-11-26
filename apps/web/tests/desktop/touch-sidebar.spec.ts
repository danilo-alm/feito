import { expect, type Page } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

const filled = "Reforma da sala";
const empty = "Viagem";
const label = "Mercado";

async function openSidebar(page: Page) {
  let workspace = newPortugueseWorkspace();
  async function write(path: string, body: object) {
    const result = await handleLocal(workspace, { method: "POST", path, body });
    expect(result.status).toBeLessThan(400);
    workspace = result.workspace;
    return result.body as { id: string };
  }
  const project = await write("/projects", { name: filled });
  await write("/projects", { name: empty });
  const tag = await write("/labels", { name: label });
  await write("/tasks", { title: "Medir a parede", projectId: project.id, labelIds: [tag.id] });
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  await page.goto("/#/hoje");
}

const row = (page: Page, name: string) => page.locator(".proj-row").filter({ hasText: name });
const actions = (page: Page, name: string) => row(page, name).getByRole("button", { name: `Ações de ${name}` });

test.describe("barra lateral no iPad", () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });

  test("mostra o menu ao lado da contagem e abre o projeto com um toque", async ({ page }) => {
    await openSidebar(page);
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);

    for (const name of [filled, empty, label]) {
      await expect(actions(page, name)).toHaveCSS("opacity", "1");
      await expect(actions(page, name)).toHaveCSS("pointer-events", "auto");
    }
    for (const name of [filled, label]) {
      const count = row(page, name).locator(".count");
      await expect(count).toHaveCSS("opacity", "1");
      const [countBox, menuBox] = [(await count.boundingBox())!, (await actions(page, name).boundingBox())!];
      expect(countBox.x + countBox.width).toBeLessThanOrEqual(menuBox.x);
    }
    await page.screenshot({ path: test.info().outputPath("barra-lateral-no-toque.png") });

    await actions(page, filled).tap();
    await expect(page.getByRole("menuitem", { name: "Editar projeto" })).toBeVisible();
    await expect(row(page, filled).locator(".count")).toHaveCSS("opacity", "1");
    await expect(page).toHaveURL(/#\/hoje$/);
    await page.keyboard.press("Escape");

    await row(page, filled).getByRole("link").tap();
    await expect(page.getByRole("heading", { name: filled, level: 1 })).toBeVisible();
    await expect(row(page, filled).locator(".count")).toHaveCSS("opacity", "1");
  });
});

test("com mouse, o menu do projeto continua aparecendo no lugar da contagem", async ({ page }) => {
  await openSidebar(page);
  await expect(actions(page, filled)).toHaveCSS("opacity", "0");
  await expect(row(page, filled).locator(".count")).toHaveCSS("opacity", "1");
  await row(page, filled).hover();
  await expect(actions(page, filled)).toHaveCSS("opacity", "1");
  await expect(row(page, filled).locator(".count")).toHaveCSS("opacity", "0");
});

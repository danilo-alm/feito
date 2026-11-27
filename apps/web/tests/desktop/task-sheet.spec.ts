import { expect, type Locator, type Page } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

const title = "Medir a parede";

test.use({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });

/** Detalhe de uma tarefa com subtarefas suficientes para o conteúdo rolar mesmo com a folha cheia. */
async function openSheet(page: Page) {
  let workspace = newPortugueseWorkspace();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: workspace.preferences.timezone }).format(new Date());
  const parent = await handleLocal(workspace, { method: "POST", path: "/tasks", body: { title, dueDate: today } });
  expect(parent.status).toBeLessThan(400);
  workspace = parent.workspace;
  const parentId = workspace.tasks[0].id;
  for (let index = 1; index <= 10; index++) {
    const child = await handleLocal(workspace, { method: "POST", path: "/tasks", body: { title: `Etapa ${index}`, parentId } });
    expect(child.status).toBeLessThan(400);
    workspace = child.workspace;
  }
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  await page.goto("/#/hoje");
  await page.locator(".task").filter({ hasText: title }).locator(".t-title").tap();
  const sheet = page.getByRole("dialog", { name: title, exact: true });
  await expect(sheet.getByRole("button", { name: "Expandir painel" })).toBeVisible();
  return sheet;
}

/** Arraste vertical com eventos de toque reais (CDP), a partir do centro do elemento. */
async function swipe(page: Page, from: Locator, dy: number) {
  const box = (await from.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const point = (offset: number) => [{ x, y: y + offset, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(0) });
  for (let step = 1; step <= 10; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point((dy * step) / 10) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

const scrollTop = (sheet: Locator) => sheet.evaluate((node) => node.scrollTop);

test("puxar o conteúdo para baixo no topo reduz a folha cheia sem fechá-la", async ({ page }) => {
  const sheet = await openSheet(page);
  await sheet.getByRole("button", { name: "Expandir painel" }).tap();
  const grab = sheet.getByRole("button", { name: "Reduzir painel" });
  await expect(grab).toBeVisible();

  for (const origin of [sheet.locator(".task-detail-head .crumb"), sheet.locator(".md-origin")]) {
    await swipe(page, origin, 200);
    await expect(sheet.getByRole("button", { name: "Expandir painel" })).toBeVisible();
    await expect(sheet).not.toHaveClass(/\bfull\b/);
    await expect(sheet).not.toHaveClass(/\bdragging\b/);
    await sheet.getByRole("button", { name: "Expandir painel" }).tap();
    await expect(grab).toBeVisible();
  }
});

/** Abre a folha cheia e deixa o conteúdo rolado. */
async function openScrolledSheet(page: Page) {
  const sheet = await openSheet(page);
  await sheet.getByRole("button", { name: "Expandir painel" }).tap();
  await expect(sheet).toHaveClass(/\bfull\b/);
  await sheet.evaluate((node) => { node.scrollTop = 120; });
  expect(await scrollTop(sheet)).toBeGreaterThan(100);
  return sheet;
}

test("com o conteúdo rolado, puxar para baixo só rola", async ({ page }) => {
  const sheet = await openScrolledSheet(page);
  await swipe(page, sheet.getByText("Etapa 5", { exact: true }), 60);
  await expect.poll(() => scrollTop(sheet)).toBeLessThan(100);
  await expect(sheet).toHaveClass(/\bfull\b/);
});

test("com o conteúdo rolado, a alça reduz a folha e ela continua reduzida", async ({ page }) => {
  const sheet = await openScrolledSheet(page);
  await swipe(page, sheet.getByRole("button", { name: "Reduzir painel" }), 200);
  await expect(sheet.getByRole("button", { name: "Expandir painel" })).toBeVisible();
  await expect.poll(() => scrollTop(sheet)).toBe(0);
  await expect(sheet).not.toHaveClass(/\bfull\b/);
});

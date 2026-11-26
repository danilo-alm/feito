import { expect, type Locator, type Page } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import type { TaskDetail } from "@feito/core/types";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

const long = "Um título bem comprido que passa da largura do campo e só aparece inteiro rolando para o lado ".repeat(2).trim();
// 120 caracteres largos, o limite dos nomes: passa da largura dos campos também em janela ampla.
const projectName = "WM".repeat(60);

const scrollLeft = (field: Locator) => field.evaluate((element) => Math.round(element.scrollLeft));

/** O Chromium já rola na horizontal sozinho; Shift + roda só funciona com o código do app, como no WebKit. */
async function expectSidewaysScroll(page: Page, field: Locator) {
  await field.evaluate((element) => { element.scrollLeft = 0; });
  await field.hover();
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Shift");
  await expect.poll(() => scrollLeft(field)).toBe(120);
  await page.mouse.wheel(80, 0);
  await expect.poll(() => scrollLeft(field)).toBe(200);
  await page.mouse.wheel(-200, 0);
  await expect.poll(() => scrollLeft(field)).toBe(0);
}

for (const narrow of [false, true]) {
  test(`campos de título rolam para o lado em janela ${narrow ? "estreita" : "ampla"}`, async ({ page }) => {
    await page.setViewportSize({ width: narrow ? 390 : 1180, height: 844 });
    let workspace = newPortugueseWorkspace();
    async function write(path: string, body: object) {
      const result = await handleLocal(workspace, { method: "POST", path, body });
      expect(result.status).toBeLessThan(400);
      workspace = result.workspace;
      return result.body as { id: string };
    }
    const project = await write("/projects", { name: projectName });
    await write(`/projects/${project.id}/sections`, { name: projectName });
    const task = await write("/tasks", { title: long, projectId: project.id }) as TaskDetail;
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
    await page.goto(`/#/projetos/${project.id}?tarefa=${task.id}`);

    const detail = page.getByRole("dialog");
    await expectSidewaysScroll(page, detail.getByRole("textbox", { name: "Título", exact: true }));
    await detail.getByRole("button", { name: "Fechar (Esc)" }).click();
    await expect(detail).toHaveCount(0);

    await page.getByRole("button", { name: projectName, exact: true }).first().click();
    await expectSidewaysScroll(page, page.getByRole("textbox", { name: "Nome do projeto" }));
    await page.keyboard.press("Escape");

    await page.getByRole("region", { name: projectName }).getByRole("button", { name: projectName, exact: true }).click();
    await expectSidewaysScroll(page, page.getByRole("textbox", { name: "Nome da seção" }));
    await page.keyboard.press("Escape");

    await page.keyboard.press("q");
    const quickAdd = page.getByRole("dialog", { name: "Adicionar tarefa" });
    const title = quickAdd.getByRole("textbox", { name: "Título da tarefa" });
    await title.fill(long);
    await expectSidewaysScroll(page, title);
  });
}

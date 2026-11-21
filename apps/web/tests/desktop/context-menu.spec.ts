import { expect, type Page } from "@playwright/test";
import { handleLocal, newWorkspace } from "../../../desktop/src/data/local";
import { mockDesktop, test } from "./fixtures";

const projectName = "Reforma da sala";
const sectionName = "Planejar";
const taskTitle = "Medir a parede";

async function openProject(page: Page, layout: "list" | "board" = "list") {
  let workspace = newWorkspace();
  async function write(path: string, body: object, method = "POST") {
    const result = await handleLocal(workspace, { method, path, body });
    expect(result.status).toBeLessThan(400);
    workspace = result.workspace;
    return result.body as { id: string };
  }
  const project = await write("/projects", { name: projectName });
  const section = await write(`/projects/${project.id}/sections`, { name: sectionName });
  await write("/tasks", { title: taskTitle, projectId: project.id, sectionId: section.id });
  await write(`/projects/${project.id}/view`, { layout }, "PATCH");
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  await page.goto(`/#/projetos/${project.id}`);
}

test("bloqueia o menu nativo antes de abrir um espaço", async ({ page }, testInfo) => {
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "none" } });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-titlebar", testInfo.project.name);
  const heading = page.getByRole("heading", { name: "Feito" });
  await expect(heading).toBeVisible();
  const defaultAllowed = await heading.evaluate((element) => element.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }),
  ));
  expect(defaultAllowed).toBe(false);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("cria o espaço local ao abrir uma instalação nova", async ({ page }) => {
  await mockDesktop(page, null);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hoje", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Caixa de entrada" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const layout of ["list", "board"] as const) {
  test(`abre o menu da tarefa por clique direito em ${layout}`, async ({ page }) => {
    await openProject(page, layout);
    const task = page.getByRole("button", { name: taskTitle, exact: true });
    const trigger = page.getByRole("button", { name: `Ações de “${taskTitle}”` });
    const menu = page.getByRole("menu", { name: taskTitle });
    await task.hover();
    await trigger.click();
    await expect(menu.getByRole("menuitem", { name: "Duplicar" })).toBeVisible();
    const items = await menu.locator('[role^="menuitem"]').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent));
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();

    await task.click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[role^="menuitem"]')).toHaveCount(items.length);
    expect(await menu.locator('[role^="menuitem"]').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent))).toEqual(items);
    await expect(page.getByRole("dialog", { name: taskTitle })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test("abre as ações do projeto na barra lateral e no cabeçalho, e as da seção no título", async ({ page }) => {
  await openProject(page);
  await page.getByRole("link", { name: "Caixa de entrada" }).click();
  const menu = page.getByRole("menu", { name: projectName });
  const sidebarTrigger = page.getByRole("button", { name: `Ações de ${projectName}` });
  const project = page.getByRole("link", { name: projectName });
  await project.click({ button: "right" });
  await expect(page).toHaveURL(/#\/entrada$/);
  await expect(sidebarTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem", { name: "Editar projeto" })).toBeFocused();
  await page.keyboard.press("Escape");

  await project.click();
  await page.getByRole("heading", { name: projectName }).click({ button: "right" });
  await expect(page.getByRole("button", { name: "Mais ações" })).toHaveAttribute("aria-expanded", "true");
  await menu.getByRole("menuitem", { name: "Editar projeto" }).click();
  await expect(page.getByRole("dialog", { name: "Editar projeto" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: sectionName, exact: true }).click({ button: "right" });
  await expect(page.getByRole("menu", { name: sectionName })).toBeVisible();
});

test("abre uma única folha de ações do projeto em uma janela estreita", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.emulateMedia({ colorScheme: "dark" });
  await openProject(page);
  await page.getByRole("heading", { name: projectName }).click({ button: "right" });
  const sheet = page.getByRole("dialog", { name: projectName });
  await expect(sheet).toHaveCount(1);
  await expect(sheet.getByRole("menuitem", { name: "Arquivar projeto" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

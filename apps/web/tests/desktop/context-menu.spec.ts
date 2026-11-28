import { expect, type Page } from "@playwright/test";
import { handleLocal, type Workspace } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

const projectName = "Reforma da sala";
const sectionName = "Planejar";
const taskTitle = "Medir a parede";
const secondTask = "Comprar a tinta";
const otherSection = "Executar";

async function openProject(page: Page, layout: "list" | "board" | "table" = "list") {
  let workspace = newPortugueseWorkspace();
  async function write(path: string, body: object, method = "POST") {
    const result = await handleLocal(workspace, { method, path, body });
    expect(result.status).toBeLessThan(400);
    workspace = result.workspace;
    return result.body as { id: string };
  }
  const project = await write("/projects", { name: projectName });
  const section = await write(`/projects/${project.id}/sections`, { name: sectionName });
  await write("/tasks", { title: taskTitle, projectId: project.id, sectionId: section.id });
  if (layout === "table") {
    await write("/tasks", { title: secondTask, projectId: project.id, sectionId: section.id });
    await write(`/projects/${project.id}/sections`, { name: otherSection });
  }
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
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
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

test("a Tabela abre as ações da tarefa com clique direito e mantém o título sem sublinhado", async ({ page }) => {
  await openProject(page, "table");
  const task = page.getByRole("table").getByRole("button", { name: taskTitle, exact: true });
  const trigger = page.getByRole("button", { name: `Ações de “${taskTitle}”` });
  const menu = page.getByRole("menu", { name: taskTitle, exact: true });
  const details = page.getByRole("dialog", { name: taskTitle, exact: true });

  await task.hover();
  await expect.soft(task).toHaveCSS("text-decoration-line", "none");
  await expect(task).toHaveCSS("user-select", "none");
  await task.click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: "Duplicar" })).toBeVisible();
  await expect(details).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  await menu.getByRole("menuitem", { name: "Editar" }).click();
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await task.click();
  const title = details.getByRole("textbox", { name: "Título", exact: true });
  await expect(title).toHaveValue(taskTitle);
  await expect.poll(() => page.evaluate(() => String(window.getSelection()))).toBe("");
  expect(await title.evaluate((element: HTMLInputElement) => element.selectionStart === element.selectionEnd)).toBe(true);
});

test("a Tabela reordena pelo título e move para outra seção", async ({ page }) => {
  await openProject(page, "table");
  const table = page.getByRole("table");
  const title = (name: string) => table.getByRole("button", { name, exact: true });
  const group = (name: string) => table.getByRole("rowgroup", { name });
  const titles = (name: string) => group(name).locator(".ptable-title");
  const sort = table.getByRole("button", { name: "Tarefa", exact: true });
  const taskRow = table.getByRole("row").filter({ has: page.getByRole("button", { name: taskTitle, exact: true }) });
  await sort.click();
  await expect(taskRow).not.toHaveAttribute("data-draggable");
  await sort.click();
  await sort.click();
  await expect(taskRow).toHaveAttribute("data-draggable", "true");

  const initial = await titles(sectionName).allTextContents();
  expect(initial).toHaveLength(2);
  const [firstName, secondName] = initial;
  const details = page.getByRole("dialog", { name: firstName, exact: true });
  const from = (await title(firstName).getByText(firstName).boundingBox())!;
  const to = (await title(secondName).boundingBox())!;

  await page.mouse.move(from.x + 8, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, to.y + to.height / 2 + 8, { steps: 10 });
  await expect(table.locator(".ptable-gap .drop-gap[data-open]")).toBeVisible();
  await page.mouse.up();
  await expect(titles(sectionName)).toHaveText([secondName, firstName]);
  await expect(details).toBeHidden();
  expect(await page.evaluate(() => String(window.getSelection()))).toBe("");

  // Os mesmos comandos da Lista funcionam sem mouse.
  await title(firstName).press("Alt+ArrowUp");
  await expect(titles(sectionName)).toHaveText(initial);
  await title(firstName).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mover para baixo" }).click();
  await expect(titles(sectionName)).toHaveText([secondName, firstName]);

  const source = (await title(firstName).getByText(firstName).boundingBox())!;
  const target = (await group(otherSection).getByRole("columnheader").boundingBox())!;
  await page.mouse.move(source.x + 8, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 8, target.y + target.height / 2, { steps: 10 });
  await expect(group(otherSection).locator(".drop-gap[data-open]")).toBeVisible();
  await page.mouse.up();
  await expect(titles(otherSection)).toHaveText([firstName]);

  await expect.poll(() => page.evaluate(async (name) => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: {
      invoke: (command: string) => Promise<{ value: { local: Workspace } }>;
    } }).__TAURI_INTERNALS__;
    const { value: { local } } = await bridge.invoke("read_workspace");
    const task = local.tasks.find(({ data }) => data.title === name);
    return local.sections.find(({ id }) => id === task?.sectionId)?.data.name;
  }, firstName)).toBe(otherSection);
});

test.describe("Tabela no tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, colorScheme: "dark" });

  test("oferece o menu de ações por toque", async ({ page }) => {
    await openProject(page, "table");
    await page.getByRole("table").getByRole("button", { name: `Ações de “${taskTitle}”` }).tap();
    await expect(page.getByRole("menu", { name: taskTitle }).getByRole("menuitem", { name: "Duplicar" })).toBeVisible();
  });
});

test("abre as ações do projeto na barra lateral e no cabeçalho, e as da seção no título", async ({ page }) => {
  await openProject(page);
  await page.getByRole("link", { name: "Entrada", exact: true }).click();
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

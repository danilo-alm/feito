import { expect } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

test.use({ viewport: { width: 1000, height: 520 } });

test("com muitos projetos e etiquetas, só a lista rola e o topo e os Ajustes ficam à vista", async ({ page }) => {
  let workspace = newPortugueseWorkspace();
  const create = async (path: string, name: string) => {
    const result = await handleLocal(workspace, { method: "POST", path, body: { name } });
    expect(result.status).toBe(201);
    workspace = result.workspace;
  };
  for (let index = 1; index <= 14; index++) await create("/projects", `Projeto ${index}`);
  for (const name of ["casa", "rua", "agora"]) await create("/labels", name);
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  await page.goto("/#/hoje");

  const sidebar = page.locator("nav.side");
  const list = sidebar.locator(".side-scroll");
  const settings = sidebar.getByRole("link", { name: "Ajustes" });
  const lastLabel = list.getByRole("link", { name: "rua" });
  await expect(list.getByRole("link", { name: "Projeto 14" })).toBeAttached();
  await expect(settings).toBeInViewport();
  await expect(lastLabel).not.toBeInViewport();

  await expect(list).toHaveCSS("scrollbar-width", "none");
  expect(await list.evaluate((node) => (node as HTMLElement).offsetWidth - node.clientWidth)).toBe(0);

  await list.hover();
  await page.mouse.wheel(0, 2000);
  await expect(lastLabel).toBeInViewport();
  await expect(sidebar.getByRole("button", { name: "Adicionar tarefa" })).toBeInViewport();
  await expect(settings).toBeInViewport();
  expect(await sidebar.evaluate((node) => node.scrollTop)).toBe(0);
  expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
});

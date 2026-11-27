import { expect, type Page } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

const LONG_TITLE = "Pedir orçamento para a pintura da sala e do corredor, comparar três fornecedores e confirmar o prazo de entrega";

async function openTableProject(page: Page) {
  const created = await handleLocal(newPortugueseWorkspace(), {
    method: "POST", path: "/projects", body: { name: "Reforma da sala" },
  });
  const project = created.body as { id: string };
  const captured = await handleLocal(created.workspace, {
    method: "POST", path: "/tasks", body: { projectId: project.id, title: LONG_TITLE },
  });
  expect(captured.status).toBeLessThan(400);
  const viewed = await handleLocal(captured.workspace, {
    method: "PATCH", path: `/projects/${project.id}/view`, body: { layout: "table" },
  });
  expect(viewed.status).toBeLessThan(400);
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: viewed.workspace } });
  await page.goto(`/#/projetos/${project.id}`);
}

test("trocar o layout não mostra aviso", async ({ page }) => {
  const created = await handleLocal(newPortugueseWorkspace(), {
    method: "POST", path: "/projects", body: { name: "Reforma da sala" },
  });
  const project = created.body as { id: string };
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: created.workspace } });
  await page.goto(`/#/projetos/${project.id}`);

  await page.getByRole("button", { name: /^Mostrar/ }).click();
  const menu = page.getByRole("dialog", { name: "Visualização" });
  for (const layout of ["Painel", "Calendário", "Tabela", "Lista"]) {
    await menu.getByRole("radio", { name: layout, exact: true }).click();
    await expect(menu.getByRole("radio", { name: layout, exact: true })).toBeChecked();
  }

  // As gravações são sequenciais: quando o aviso da ordenação chega, um aviso de layout já teria chegado.
  await menu.getByRole("button", { name: /^Ordenar/ }).click();
  await page.getByRole("listbox", { name: "Ordenar tarefas" }).getByRole("option", { name: "Prioridade" }).click();
  await expect(page.locator(".toast", { hasText: "Ordenado por prioridade" })).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(1);
});

test.describe("no celular", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("um projeto salvo em Tabela abre em Lista e continua salvo assim", async ({ page }) => {
    await openTableProject(page);

    await page.getByRole("button", { name: "Mostrar: Lista" }).click();
    const sheet = page.getByRole("dialog", { name: "Visualização" });
    await expect(sheet.getByRole("radio")).toHaveText(["Lista", "Painel", "Calendário"]);
    await expect(sheet.getByRole("radio", { name: "Lista" })).toBeChecked();
    await expect(page.locator(".ptable")).toHaveCount(0);

    // Mudar outra opção da visão não troca o layout salvo.
    await sheet.getByRole("switch", { name: "Mostrar concluídas" }).click();
    await expect(sheet.getByRole("switch", { name: "Mostrar concluídas" })).toBeChecked();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1180, height: 800 });
    await expect(page.getByRole("button", { name: "Mostrar: Tabela" })).toBeVisible();
    await expect(page.locator(".ptable")).toBeVisible();
  });
});

test.describe("no celular deitado", () => {
  test.use({ viewport: { width: 932, height: 430 }, hasTouch: true, isMobile: true });

  test("continua sem Tabela, mesmo com a tela larga", async ({ page }) => {
    await openTableProject(page);
    await page.getByRole("button", { name: "Mostrar: Lista" }).click();
    await expect(page.getByRole("dialog", { name: "Visualização" }).getByRole("radio")).toHaveText(["Lista", "Painel", "Calendário"]);
    await expect(page.locator(".ptable")).toHaveCount(0);
  });
});

for (const [device, width, height] of [["iPad mini em pé", 744, 1133], ["iPad em pé", 820, 1180]] as const) {
  test.describe(`no ${device}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test("mostra a Tabela e a opção no menu", async ({ page }) => {
      await openTableProject(page);
      await expect(page.locator(".ptable")).toBeVisible();
      // As colunas padrão cabem sem rolagem lateral, e o título longo usa uma segunda linha.
      await expect.poll(() => page.locator(".ptable-scroll").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
      expect(await page.getByRole("button", { name: LONG_TITLE, exact: true }).evaluate((node) => {
        const text = node.firstElementChild as HTMLElement;
        return Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight));
      })).toBe(2);
      await page.getByRole("button", { name: "Mostrar: Tabela" }).click();
      const sheet = page.getByRole("dialog", { name: "Visualização" });
      await expect(sheet.getByRole("radio", { name: "Tabela" })).toBeChecked();
      await sheet.getByRole("radio", { name: "Lista" }).click();
      await expect(page.locator(".ptable")).toHaveCount(0);
      await sheet.getByRole("radio", { name: "Tabela" }).click();
      await expect(page.locator(".ptable")).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("tablet-tabela.png") });
    });
  });
}

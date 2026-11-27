import { expect } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

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
    const created = await handleLocal(newPortugueseWorkspace(), {
      method: "POST", path: "/projects", body: { name: "Reforma da sala" },
    });
    const project = created.body as { id: string };
    const viewed = await handleLocal(created.workspace, {
      method: "PATCH", path: `/projects/${project.id}/view`, body: { layout: "table" },
    });
    expect(viewed.status).toBeLessThan(400);
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: viewed.workspace } });
    await page.goto(`/#/projetos/${project.id}`);

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

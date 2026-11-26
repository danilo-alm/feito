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

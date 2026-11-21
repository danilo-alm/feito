import { expect, test } from "./fixtures";

test("etiquetas na lateral oferecem ações no hover, teclado e clique direito", async ({ page, api, isMobile }) => {
  test.skip(isMobile, "A lateral aparece em larguras de desktop.");
  const label = await api<{ id: string }>("POST", "/labels", { name: "Etiqueta do menu lateral" });
  await page.goto("/hoje");
  const sidebar = page.getByRole("navigation", { name: "Navegação principal" });
  const link = sidebar.getByRole("link", { name: "Etiqueta do menu lateral", exact: true });
  const trigger = sidebar.getByRole("button", { name: "Ações de Etiqueta do menu lateral", exact: true });
  await page.mouse.move(800, 500);
  await expect(trigger).toHaveCSS("opacity", "0");
  await link.hover();
  await expect(trigger).toHaveCSS("opacity", "1");
  await trigger.click();
  await page.getByRole("menuitem", { name: "Renomear etiqueta", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Renomear etiqueta", exact: true });
  await rename.getByRole("textbox", { name: "Nome", exact: true }).fill("Etiqueta renomeada na lateral");
  await rename.getByRole("button", { name: "Salvar", exact: true }).click();
  const renamed = sidebar.getByRole("link", { name: "Etiqueta renomeada na lateral", exact: true });
  await expect(renamed).toBeVisible();
  await expect(page).toHaveURL(/\/hoje$/);

  const renamedTrigger = sidebar.getByRole("button", { name: "Ações de Etiqueta renomeada na lateral", exact: true });
  await page.mouse.move(800, 500);
  await renamedTrigger.focus();
  await expect(renamedTrigger).toHaveCSS("opacity", "1");
  await renamedTrigger.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Excluir etiqueta…", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(renamedTrigger).toBeFocused();

  await renamed.click();
  await expect(page).toHaveURL(new RegExp(`/etiquetas/${label.id}$`));
  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Excluir etiqueta…", exact: true }).click();
  const remove = page.getByRole("dialog", { name: "Excluir a etiqueta “Etiqueta renomeada na lateral”?", exact: true });
  await remove.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(renamed).toHaveCount(0);
  await expect(page).toHaveURL(/\/hoje$/);
});

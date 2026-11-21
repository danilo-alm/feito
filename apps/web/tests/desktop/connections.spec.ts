import { expect } from "@playwright/test";
import { newWorkspace } from "../../../desktop/src/data/local";
import { mockDesktop, test } from "./fixtures";

for (const narrow of [false, true]) {
  test(`edita a conexão com ações por ícone em janela ${narrow ? "estreita" : "ampla"}`, async ({ page }) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: narrow ? "dark" : "light" });
    const workspace = newWorkspace();
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "server", server: {
      origin: "https://feito.example", user: { id: "b1fa8244-3300-4383-abb7-80fd5216a6fb", email: "ana@example.test" },
      confirmed: workspace, working: workspace, pending: [], cursor: 0,
    } } }, true);
    await page.goto("/#/ajustes");
    const edit = page.getByRole("button", { name: "Editar conexão", exact: true });
    const sync = page.getByRole("button", { name: "Sincronizar agora", exact: true });
    const logout = page.getByRole("button", { name: "Encerrar sessão", exact: true });
    await expect(sync).toBeEnabled();
    for (const button of [edit, sync, logout]) {
      await expect(button).toHaveText("");
      await button.focus();
      await expect(page.getByRole("tooltip")).toHaveText((await button.getAttribute("aria-label"))!);
    }
    await edit.click();
    const form = page.getByRole("form", { name: "Editar conexão" });
    await expect(page.getByRole("dialog", { name: "Editar conexão" })).toBeVisible();
    await expect(form.getByLabel("Endereço HTTPS do Feito")).toBeFocused();
    await expect(form.getByLabel("Endereço HTTPS do Feito")).toHaveCSS("font-size", "14px");
    await expect(form.getByLabel("Endereço HTTPS do Feito")).toHaveCSS("height", "36px");
    await expect(form.locator(".lbl").first()).toHaveCSS("font-size", "13px");
    await expect(form.locator(".ps-field").first()).toHaveCSS("row-gap", "6px");
    await expect(form.getByLabel("Endereço HTTPS do Feito")).toHaveValue("https://feito.example");
    await expect(form.getByLabel("E-mail")).toHaveValue("ana@example.test");
    await expect(form.getByLabel("Senha", { exact: true })).toBeEmpty();
    await page.screenshot({ path: `/tmp/feito-desktop-dialog-${narrow ? "narrow" : "wide"}.png`, fullPage: true });
    await form.getByLabel("Senha", { exact: true }).fill("senha sintética");
    await form.getByRole("button", { name: "Cancelar" }).click();
    await expect(edit).toBeFocused();
    await edit.click();
    await expect(form.getByLabel("Senha", { exact: true })).toBeEmpty();
    await form.getByLabel("Endereço HTTPS do Feito").fill("https://novo.example");
    await form.getByLabel("Senha", { exact: true }).fill("nova senha sintética");
    await form.getByRole("button", { name: "Salvar conexão" }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText("novo.example", { exact: false })).toBeVisible();
    await expect(page.getByText("feito.example", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `/tmp/feito-connections-${narrow ? "narrow" : "wide"}.png`, fullPage: true });
  });
}

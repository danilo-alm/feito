import { expect, test } from "@playwright/test";
import { newWorkspace } from "@feito/core/product/local-executor";

test("edita o acesso num diálogo e abre outra instalação sem enviar credenciais", async ({ page, isMobile }) => {
  const user = { id: "b1fa8244-3300-4383-abb7-80fd5216a6fb", email: "ana@example.test" };
  const workspace = newWorkspace();
  workspace.preferences.locale = "pt-BR";
  const logins: unknown[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/product-events") return route.abort();
    if (path === "/api/v1/auth/login") logins.push(route.request().postDataJSON());
    return route.fulfill({ json: path === "/api/v1/desktop-sync"
      ? { user, cursor: 0, workspace }
      : { user, mustChangePassword: false } });
  });
  await page.goto("/ajustes");
  const edit = page.getByRole("button", { name: "Editar conexão", exact: true });
  await expect(edit).toBeVisible();
  if (!isMobile) {
    await edit.scrollIntoViewIfNeeded();
    await expect(edit).toBeInViewport();
    await page.mouse.move(0, 0);
    await edit.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Editar conexão");
  }
  await expect(page.getByRole("button", { name: "Sincronizar agora", exact: true })).toHaveText("");
  await expect(page.getByRole("button", { name: "Sair", exact: true })).toHaveText("");
  await edit.click();
  const dialog = page.getByRole("dialog", { name: "Editar conexão" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("E-mail")).toHaveCSS("font-size", "14px");
  await expect(dialog.getByLabel("E-mail")).toHaveCSS("height", "36px");
  await expect(dialog.locator(".lbl").first()).toHaveCSS("font-size", "13px");
  await expect(dialog.locator(".ps-field").first()).toHaveCSS("row-gap", "6px");
  await expect(dialog.getByLabel("E-mail")).toHaveValue(user.email);
  await expect(dialog.getByLabel("Senha", { exact: true })).toBeEmpty();
  await dialog.getByLabel("Senha", { exact: true }).fill("senha sintética");
  await dialog.getByRole("button", { name: "Salvar conexão" }).click();
  await expect(dialog).toHaveCount(0);
  expect(logins).toEqual([{ email: user.email, password: "senha sintética" }]);
  await edit.click();
  await expect(dialog.getByLabel("Senha", { exact: true })).toBeEmpty();
  await page.screenshot({ path: `/tmp/feito-web-connection-${isMobile ? "narrow" : "wide"}.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
  await edit.click();
  await dialog.getByLabel("Endereço HTTPS do Feito").fill("https://outro.example");
  await expect(dialog.getByLabel("Senha", { exact: true })).toHaveCount(0);
  await page.route("https://outro.example/**", (route) => route.fulfill({ contentType: "text/html", body: "Outro servidor" }));
  await dialog.getByRole("button", { name: "Abrir servidor" }).click();
  await expect(page).toHaveURL("https://outro.example/entrar?voltar=%2Fajustes");
  expect(logins).toHaveLength(1);
});

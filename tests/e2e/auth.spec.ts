import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { login } from "./fixtures";
import { ACCOUNTS_FILE } from "./global-setup";

test.describe("entrar", () => {
  test.skip(({ isMobile }) => isMobile, "Fluxo de conta coberto no desktop");

  test("recusa senha errada e exige trocar a senha provisória no primeiro acesso", async ({ page }) => {
    const { fresh } = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    await login(page, { email: fresh.email, password: `${fresh.password}-errada` });
    await expect(page.locator(".banner.error")).toHaveText("E-mail ou senha incorretos.");

    await login(page, fresh);
    await page.waitForURL("**/trocar-senha");
    await expect(page.getByRole("heading", { name: "Defina sua senha" })).toBeVisible();
    const next = `${fresh.password}-definitiva`;
    await page.getByLabel("Senha provisória").fill(fresh.password);
    await page.getByLabel("Nova senha", { exact: true }).fill("curta");
    await expect(page.getByText("Frase-senha com 15 a 128 caracteres · 5.")).toHaveClass(/field-error/);
    await page.getByLabel("Nova senha", { exact: true }).fill(next);
    await page.getByLabel("Repita a nova senha").fill(next);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await page.waitForURL("**/hoje");
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();

    // Sair encerra a sessão e protege as telas.
    await page.goto("/ajustes");
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL("**/entrar");
    await page.goto("/hoje");
    await page.waitForURL(/\/entrar\?voltar=%2Fhoje/);
  });
});

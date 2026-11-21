import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { login, row } from "./fixtures";
import { ACCOUNTS_FILE } from "./global-setup";

async function add(page: Page, isMobile: boolean, title: string) {
  if (isMobile) await page.locator("button[aria-label='Adicionar tarefa']").click();
  else await page.keyboard.press("q");
  await page.getByRole("dialog", { name: "Adicionar tarefa" }).getByLabel("Título da tarefa").fill(title);
  await page.getByRole("dialog", { name: "Adicionar tarefa" }).getByLabel("Título da tarefa").press("Enter");
  await expect(page.getByText(/Tarefa adicionada/)).toBeVisible();
}

async function diskKeys(page: Page) {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open("feito-browser");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const query = database.transaction("records").objectStore("records").getAllKeys();
      query.onsuccess = () => {
        resolve(query.result.map(String));
        database.close();
      };
      query.onerror = () => reject(query.error);
    };
  }));
}

test("sair offline confirma o descarte, encerra as abas e preserva o espaço sem conta", async ({ page, context, isMobile }, info) => {
  const { active } = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Usar neste navegador, sem conta" }).click();
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  await page.goto("/entrada");
  await expect(page.getByRole("heading", { name: "Caixa de entrada", level: 1 })).toBeVisible();
  await add(page, isMobile, "Só neste navegador");
  await expect(row(page, "Só neste navegador")).toBeVisible();

  await login(page, active[info.project.name], "/entrar?voltar=%2Fentrada");
  await expect(page.getByRole("heading", { name: "Caixa de entrada", level: 1 })).toBeVisible();
  await expect(row(page, "Só neste navegador")).toHaveCount(0);
  const settings = await context.newPage();
  await settings.goto("/ajustes");
  await expect(settings.getByRole("region", { name: "Acesso offline" }))
    .toContainText("Pronto para uso offline neste navegador.", { timeout: 25_000 });
  await context.setOffline(true);
  await add(page, isMobile, "Só na fila da conta");
  await expect(row(page, "Só na fila da conta")).toBeVisible();
  await expect(settings.getByRole("region", { name: "Sincronização", exact: true })).toContainText("1 alteração pendente");
  const reopened = await context.newPage();
  const offlineNavigation = await reopened.goto("/entrada");
  expect(offlineNavigation?.fromServiceWorker()).toBe(true);
  await expect(row(reopened, "Só na fila da conta")).toBeVisible();
  await expect(row(reopened, "Só neste navegador")).toHaveCount(0);

  await settings.getByRole("button", { name: "Sair", exact: true }).click();
  const confirmation = settings.getByRole("dialog", { name: "Sair e descartar alterações?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await confirmation.getByRole("button", { name: "Cancelar" }).click();
  await expect(row(page, "Só na fila da conta")).toBeVisible();
  await expect.poll(() => diskKeys(settings)).toEqual([expect.stringMatching(/^account:/), "local", "meta"]);

  await settings.getByRole("button", { name: "Sair", exact: true }).click();
  await confirmation.getByRole("button", { name: "Sair e descartar", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Entrar no Feito" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Entrar no Feito" })).toBeVisible();
  await expect(reopened.getByRole("heading", { name: "Entrar no Feito" })).toBeVisible();
  await expect.poll(() => diskKeys(page)).toEqual(["local", "meta"]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Entrar no Feito" })).toBeVisible();
  await page.getByRole("button", { name: "Usar neste navegador, sem conta" }).click();
  await expect(row(page, "Só neste navegador")).toBeVisible();
  await expect(row(page, "Só na fila da conta")).toHaveCount(0);

  await context.setOffline(false);
  await expect.poll(async () => (await page.request.get("/api/v1/auth/session")).status()).toBe(401);
  await expect.poll(() => diskKeys(page)).toEqual(["local", "meta"]);
});

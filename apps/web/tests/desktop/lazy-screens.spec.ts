import { expect } from "@playwright/test";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

test("mantém o diálogo e o rascunho enquanto outra tela carrega", async ({ page }) => {
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(/\/(?:src\/settings\.tsx|assets\/settings-[^/]+\.js)(?:\?.*)?$/, async (route) => {
    requested.resolve();
    await release.promise;
    await route.continue();
  });
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: newPortugueseWorkspace() } });
  await page.goto("/#/hoje");
  await expect(page.getByRole("heading", { name: "Hoje", exact: true })).toBeVisible();
  await page.keyboard.press("q");
  const editor = page.getByRole("dialog", { name: "Adicionar tarefa", exact: true });
  const title = editor.getByLabel("Título da tarefa");
  await title.fill("Rascunho durante o carregamento");
  try {
    // O histórico pode mudar com um diálogo aberto, sem remontar o AppShell.
    await page.evaluate(() => { location.hash = "#/ajustes"; });
    await requested.promise;
    await expect(page.locator("main .loading")).toBeVisible();
    await expect(title).toHaveValue("Rascunho durante o carregamento");
    await expect(title).toBeFocused();
  } finally {
    release.resolve();
  }
  await expect(page.locator("main .settings")).toBeVisible();
  await expect(title).toHaveValue("Rascunho durante o carregamento");
  await expect(title).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Ajustes", exact: true })).toBeVisible();
});

test("permite sair de uma tela enquanto seu código ainda carrega", async ({ page }) => {
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(/\/(?:src\/settings\.tsx|assets\/settings-[^/]+\.js)(?:\?.*)?$/, async (route) => {
    requested.resolve();
    await release.promise;
    await route.continue();
  });
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: newPortugueseWorkspace() } });
  await page.goto("/#/hoje");
  await expect(page.getByRole("heading", { name: "Hoje", exact: true })).toBeVisible();
  try {
    await page.getByRole("link", { name: "Ajustes", exact: true }).click();
    await requested.promise;
    await expect(page.getByRole("status", { name: "Carregando", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Hoje", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Hoje", exact: true })).toBeVisible();
  } finally {
    release.resolve();
  }
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ajustes", exact: true })).toBeVisible();
});

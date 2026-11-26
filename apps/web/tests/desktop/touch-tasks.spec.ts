import { expect, type Page } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

const titles = ["Medir a parede", "Comprar a tinta"];

/** Tarefas para hoje: aparecem em Hoje (com a origem na linha do título) e na Caixa de entrada (sem origem). */
async function openTasks(page: Page) {
  let workspace = newPortugueseWorkspace();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: workspace.preferences.timezone }).format(new Date());
  for (const title of titles) {
    const result = await handleLocal(workspace, { method: "POST", path: "/tasks", body: { title, dueDate: today } });
    expect(result.status).toBeLessThan(400);
    workspace = result.workspace;
  }
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  await page.goto("/#/hoje");
}

const row = (page: Page, title: string) => page.locator(".task").filter({ hasText: title });

// iPad deitado: largura de desktop, mas sem ponteiro que paire.
for (const [name, viewport] of [["deitado", { width: 1180, height: 820 }], ["em pé", { width: 1024, height: 1366 }]] as const) {
  test.describe(`iPad ${name}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test("mostra só o menu em todas as tarefas e abre cada uma com um toque", async ({ page }) => {
      await openTasks(page);
      expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);

      for (const path of ["/#/hoje", "/#/entrada"]) {
        await page.goto(path);
        for (const title of titles) {
          const task = row(page, title);
          await expect(task.locator(".t-acts")).toHaveCSS("opacity", "1");
          await expect(task.getByRole("button", { name: `Ações de “${title}”` })).toBeVisible();
          await expect(task.getByRole("button", { name: `Editar “${title}”` })).toBeHidden();
          await expect(task.getByRole("button", { name: `Agendar “${title}”` })).toBeHidden();
          await expect(task.locator(".grip")).toBeHidden();
        }
        await page.screenshot({ path: test.info().outputPath(`tarefas-${path.slice(3)}.png`) });
      }

      for (const title of titles) {
        await row(page, title).locator(".t-title").tap();
        const detail = page.getByRole("dialog", { name: title, exact: true });
        await expect(detail).toBeVisible();
        await detail.getByRole("button", { name: "Fechar (Esc)" }).tap();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        // A tarefa que acabou de ser tocada não fica num estado diferente das outras.
        await expect(row(page, title).getByRole("button", { name: `Editar “${title}”` })).toBeHidden();
        await expect(row(page, title).locator(".grip")).toBeHidden();
      }

      await row(page, titles[0]).getByRole("button", { name: `Ações de “${titles[0]}”` }).tap();
      await expect(page.getByRole("menu", { name: titles[0] }).getByRole("menuitem", { name: "Duplicar" })).toBeVisible();
    });
  });
}

test("com mouse, as ações continuam aparecendo ao passar sobre a tarefa", async ({ page }) => {
  await openTasks(page);
  const task = row(page, titles[0]);
  await expect(task.locator(".t-acts")).toHaveCSS("opacity", "0");
  await task.hover();
  await expect(task.locator(".t-acts")).toHaveCSS("opacity", "1");
  await expect(task.getByRole("button", { name: `Editar “${titles[0]}”` })).toBeVisible();
  await expect(task.getByRole("button", { name: `Agendar “${titles[0]}”` })).toBeVisible();
});

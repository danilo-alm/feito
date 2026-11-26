import { expect } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import type { TaskDetail } from "@feito/core/types";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

for (const narrow of [false, true]) {
  test(`Esc salva a edição sem fechar o detalhe em janela ${narrow ? "estreita" : "ampla"}`, async ({ page }) => {
    await page.setViewportSize({ width: narrow ? 390 : 1180, height: 844 });
    const created = await handleLocal(newPortugueseWorkspace(), {
      method: "POST", path: "/tasks", body: { title: "Título antigo", description: "Texto antigo" },
    });
    const task = created.body as TaskDetail;
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: created.workspace } });
    await page.goto(`/#/entrada?tarefa=${task.id}`);
    const detail = page.getByRole("dialog");
    const title = detail.getByRole("textbox", { name: "Título", exact: true });
    const preview = detail.getByRole("region", { name: "Descrição", exact: true });
    const description = detail.getByRole("textbox", { name: "Descrição", exact: true });
    const row = page.locator(".task").filter({ has: page.locator(".t-title") });

    await title.click();
    await title.fill("Título novo");
    await title.press("Escape");
    await expect(detail).toBeFocused();
    await expect(title).toHaveValue("Título novo");
    await expect(row.locator(".t-title")).toHaveText("Título novo");

    // O foco continua preso no diálogo depois de sair do campo.
    await page.keyboard.press("Shift+Tab");
    expect(await detail.evaluate((element) => element.contains(document.activeElement) && element !== document.activeElement)).toBe(true);

    await preview.click();
    await description.fill("Texto **novo**");
    await description.press("Escape");
    await expect(preview).toBeFocused();
    await expect(preview.locator("strong")).toHaveText("novo");
    await expect(row.locator(".t-desc strong")).toHaveText("novo");

    // Pela barra de formatação o Esc também só encerra a edição.
    await preview.press("Enter");
    await description.press("ControlOrMeta+A");
    const italic = detail.getByRole("button", { name: "Itálico", exact: true });
    await italic.focus();
    await page.keyboard.press("Escape");
    await expect(preview).toBeFocused();
    await expect(detail).toBeVisible();

    // Sem campo em edição, Esc fecha.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // O foco automático no título (tarefa já carregada) não conta como edição.
    await row.locator(".t-click").click();
    await expect(detail).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

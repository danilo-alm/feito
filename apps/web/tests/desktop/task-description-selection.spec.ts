import { expect } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import type { TaskDetail } from "@feito/core/types";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

for (const narrow of [false, true]) {
  test(`arrastar da descrição vazia não seleciona texto em janela ${narrow ? "estreita" : "ampla"}`, async ({ page }) => {
    await page.setViewportSize({ width: narrow ? 390 : 1180, height: 844 });
    if (narrow) await page.emulateMedia({ reducedMotion: "reduce" });
    const created = await handleLocal(newPortugueseWorkspace(), {
      method: "POST", path: "/tasks", body: { title: "Tarefa ainda sem descrição" },
    });
    const task = created.body as TaskDetail;
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: created.workspace } });
    await page.goto(`/#/entrada?tarefa=${task.id}`);
    const detail = page.getByRole("dialog", { name: task.title, exact: true });
    const title = detail.getByRole("textbox", { name: "Título", exact: true });
    const preview = detail.getByRole("region", { name: "Descrição", exact: true });
    const description = detail.getByRole("textbox", { name: "Descrição", exact: true });

    // Sair do campo vazio deixa só o texto de exemplo, sem a barra de formatação.
    await description.focus();
    await title.focus();
    await expect(preview).toBeVisible();
    await expect(detail.getByRole("group", { name: "Formatação da descrição" })).toHaveCount(0);

    const from = (await preview.getByText("Descrição", { exact: true }).boundingBox())!;
    const to = (await title.boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    expect(await page.evaluate(() => String(window.getSelection()))).toBe("");

    // O clique continua abrindo a edição.
    await preview.click();
    await expect(description).toBeFocused();
  });
}

import { expect, row, test } from "./fixtures";
import type { TaskDetail } from "@feito/core/types";

test("renderiza Markdown e preserva a fonte ao editar a descrição", async ({ page, api }) => {
  const source = "## Planejamento\n\n**Materiais**\n\n- Madeira\n- Parafusos\n\n[Referência](https://example.com)";
  const task = await api<TaskDetail>("POST", "/tasks", { title: "Descrição em Markdown", description: source });
  await page.goto(`/entrada?tarefa=${task.id}`);
  const detail = page.getByRole("dialog", { name: task.title, exact: true });
  const preview = detail.getByRole("region", { name: "Descrição", exact: true });
  await expect(preview.getByRole("heading", { name: "Planejamento" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("Materiais");
  await expect(preview.getByRole("listitem")).toHaveCount(2);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: test.info().outputPath(`markdown-${colorScheme}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await detail.getByRole("region", { name: "Descrição", exact: true }).click();
  const input = detail.getByRole("textbox", { name: "Descrição", exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(source);
  await input.fill(`${source}\n\n~~Revisado~~`);
  await detail.getByRole("textbox", { name: "Título", exact: true }).click();
  await expect(preview.locator("del")).toHaveText("Revisado");
  await expect.poll(() => api<TaskDetail>("GET", `/tasks/${task.id}`)).toMatchObject({ description: `${source}\n\n~~Revisado~~` });
  await page.reload();
  await expect(preview.locator("del")).toHaveText("Revisado");
  await page.keyboard.press("Escape");
  await expect(row(page, task.title)).toBeVisible();
});

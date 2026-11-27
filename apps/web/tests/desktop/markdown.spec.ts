import { expect } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import type { TaskDetail } from "@feito/core/types";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

const markdown = "# Plano\n\n**Comprar** e *medir*.\n\n- [x] Pronto\n- Pendente\n\n[Referência](https://example.com)\n\n```ts\nconst largura = 120;\n```\n\n| Material | Quantidade |\n| --- | --- |\n| Madeira | 2 |";

test("formata a descrição ao sair do campo sem perder o rascunho", async ({ page }) => {
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: newPortugueseWorkspace() } });
  await page.goto("/#/entrada");
  await page.getByRole("button", { name: "Adicionar tarefa", exact: true }).first().click();
  const editor = page.getByRole("form", { name: "Adicionar tarefa", exact: true });
  await editor.getByRole("textbox", { name: "Título da tarefa" }).fill("Criada com Markdown");
  const input = editor.getByRole("textbox", { name: "Descrição", exact: true });
  await input.fill("**Resumo**\n\n- Item");
  await expect(editor.getByRole("group", { name: "Formatação da descrição" })).toHaveCount(0);
  await editor.getByRole("textbox", { name: "Título da tarefa" }).click();
  await expect(editor.locator("strong")).toHaveText("Resumo");
  await editor.getByRole("region", { name: "Descrição", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("**Resumo**\n\n- Item");
  await editor.getByRole("button", { name: "Adicionar tarefa", exact: true }).click();
  const row = page.locator(".task").filter({ hasText: "Criada com Markdown" });
  await expect(row.locator(".t-desc strong")).toHaveText("Resumo");
  await row.getByRole("button", { name: /^Criada com Markdown/ }).click();
  await expect(page.getByRole("region", { name: "Descrição", exact: true }).getByRole("listitem")).toHaveText("Item");
});

for (const width of [320, 390]) {
  test.describe(`celular de ${width} px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("mantém a barra de formatação numa linha só", async ({ page }) => {
      const created = await handleLocal(newPortugueseWorkspace(), {
        method: "POST", path: "/tasks", body: { title: "Formatar no celular", description: "Texto" },
      });
      const task = created.body as TaskDetail;
      await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: created.workspace } });
      await page.goto(`/#/entrada?tarefa=${task.id}`);
      const detail = page.getByRole("dialog", { name: task.title, exact: true });
      await detail.getByRole("region", { name: "Descrição", exact: true }).tap();
      const tools = detail.getByRole("group", { name: "Formatação da descrição" });
      await expect(tools.getByRole("button")).toHaveCount(10);
      // Espera a barra terminar de abrir antes de medir.
      await expect(tools.getByRole("button", { name: "Código", exact: true })).toBeInViewport({ ratio: 1 });
      const layout = await tools.evaluate((group) => {
        const bounds = group.getBoundingClientRect();
        const buttons = [...group.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
        return {
          rows: new Set(buttons.map((button) => Math.round(button.top))).size,
          inside: buttons.every((button) => button.left >= bounds.left - 0.5 && button.right <= bounds.right + 0.5),
          narrowest: Math.min(...buttons.map((button) => button.width)),
        };
      });
      expect(layout.rows).toBe(1);
      expect(layout.inside).toBe(true);
      // Em 320 px os dez botões dividem 236 px; não podem encolher além disso.
      expect(layout.narrowest).toBeGreaterThanOrEqual(23.5);
      await page.screenshot({ path: test.info().outputPath("formatting-touch.png") });
    });
  });
}

for (const narrow of [false, true]) {
  test(`campos de tarefa sem zoom automático em janela ${narrow ? "estreita" : "ampla"}`, async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 844 });
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: newPortugueseWorkspace() } });
    await page.goto("/#/entrada");
    await page.getByRole("button", { name: "Adicionar tarefa", exact: true }).first().click();
    await page.setViewportSize({ width: narrow ? 390 : 1180, height: 844 });
    const editor = page.getByRole("form", { name: "Adicionar tarefa", exact: true });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(editor.getByRole("textbox", { name: "Título da tarefa" })).toHaveCSS("font-size", narrow ? "16px" : "15px");
      const description = editor.getByRole("textbox", { name: "Descrição", exact: true });
      await description.click();
      await expect(description).toBeFocused();
      await expect(description).toHaveCSS("font-size", narrow ? "16px" : "13.5px");
    }
    await editor.getByRole("button", { name: "Cancelar (Esc)" }).click();
    await page.keyboard.press("q");
    const dialog = page.getByRole("dialog", { name: "Adicionar tarefa", exact: true });
    const description = dialog.getByRole("textbox", { name: "Descrição", exact: true });
    await description.click();
    await expect(description).toBeFocused();
    await expect(description).toHaveCSS("font-size", narrow ? "16px" : "14px");
    await page.screenshot({ path: test.info().outputPath("task-editor.png"), fullPage: true });
  });

  test(`barra de formatação em janela ${narrow ? "estreita" : "ampla"}`, async ({ page }) => {
    await page.setViewportSize({ width: narrow ? 390 : 1180, height: 844 });
    if (narrow) await page.emulateMedia({ reducedMotion: "reduce" });
    const created = await handleLocal(newPortugueseWorkspace(), {
      method: "POST", path: "/tasks", body: { title: "Formatar descrição", description: "Selecionar texto" },
    });
    const task = created.body as TaskDetail;
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: created.workspace } });
    await page.goto(`/#/entrada?tarefa=${task.id}`);
    const detail = page.getByRole("dialog", { name: task.title, exact: true });
    await detail.getByRole("region", { name: "Descrição", exact: true }).click();
    const input = detail.getByRole("textbox", { name: "Descrição", exact: true });
    await expect(input).toHaveCSS("font-size", narrow ? "16px" : "14px");
    const tools = detail.getByRole("group", { name: "Formatação da descrição" });
    for (const [label, result] of [
      ["Título de nível 1", "# Selecionar texto"], ["Negrito", "**Selecionar texto**"],
      ["Itálico", "*Selecionar texto*"], ["Tachado", "~~Selecionar texto~~"],
      ["Lista com marcadores", "- Selecionar texto"], ["Lista numerada", "1. Selecionar texto"],
      ["Lista de tarefas", "- [ ] Selecionar texto"],
      ["Citação", "> Selecionar texto"], ["Código", "`Selecionar texto`"],
    ]) {
      await input.fill("Selecionar texto");
      await input.press("ControlOrMeta+A");
      await tools.getByRole("button", { name: label, exact: true }).click();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(result);
    }
    await input.fill("Referência");
    await input.press("ControlOrMeta+A");
    // Acesso pela sequência de foco, sem fechar o campo ao entrar na barra.
    await input.press("Tab");
    await expect(tools.getByRole("button", { name: "Título de nível 1" })).toBeFocused();
    const link = tools.getByRole("button", { name: "Inserir link", exact: true });
    await link.focus();
    await link.press("Enter");
    await expect(input).toBeFocused();
    await input.pressSequentially("https://example.com");
    await expect(input).toHaveValue("[Referência](https://example.com)");

    await input.fill("Desfazer");
    await input.press("ControlOrMeta+A");
    await tools.getByRole("button", { name: "Negrito", exact: true }).click();
    await expect(input).toHaveValue("**Desfazer**");
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("Desfazer");
    await input.press("ControlOrMeta+b");
    await expect(input).toHaveValue("**Desfazer**");

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: test.info().outputPath(`formatting-${colorScheme}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await detail.getByRole("textbox", { name: "Título", exact: true }).click();
    await expect(tools).toHaveCount(0);
    await expect(detail.getByRole("region", { name: "Descrição", exact: true }).locator("strong")).toHaveText("Desfazer");
    await page.keyboard.press("Escape");
    await page.goto(`/#/entrada?tarefa=${task.id}`);
    await expect(detail.getByRole("region", { name: "Descrição", exact: true }).locator("strong")).toHaveText("Desfazer");
  });

  test(`Markdown em janela ${narrow ? "estreita" : "ampla"}`, async ({ page }) => {
    await page.setViewportSize({ width: narrow ? 390 : 1180, height: 844 });
    const created = await handleLocal(newPortugueseWorkspace(), {
      method: "POST", path: "/tasks", body: { title: "Tarefa com Markdown", description: markdown },
    });
    const task = created.body as TaskDetail;
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: created.workspace } });
    await page.goto(`/#/entrada?tarefa=${task.id}`);
    const detail = page.getByRole("dialog", { name: task.title, exact: true });
    const preview = detail.getByRole("region", { name: "Descrição", exact: true });
    await expect(preview.getByRole("heading", { name: "Plano", exact: true })).toBeVisible();
    const headingSize = await preview.getByRole("heading", { name: "Plano", level: 1 })
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    const taskTitleSize = await detail.getByRole("textbox", { name: "Título", exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(headingSize).toBeLessThan(taskTitleSize);
    await expect(preview.locator("strong")).toHaveText("Comprar");
    await expect(preview.getByRole("checkbox")).toBeChecked();
    await expect(preview.getByRole("checkbox")).toBeDisabled();
    await expect(preview.getByRole("link", { name: "Referência" })).toHaveAttribute("href", "https://example.com");
    await expect(preview.getByRole("table")).toContainText("Madeira");

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.screenshot({ path: test.info().outputPath(`markdown-${colorScheme}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    await expect(detail.getByRole("button", { name: /^(Editar|Visualizar)$/ })).toHaveCount(0);
    await expect(detail.getByText("Descrição · Markdown", { exact: true })).toHaveCount(0);
    await preview.focus();
    await preview.press("Enter");
    const input = detail.getByRole("textbox", { name: "Descrição", exact: true });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(markdown);
    await input.fill(`${markdown}\n\n~~Antigo~~ **Novo**`);
    await detail.getByRole("textbox", { name: "Título", exact: true }).click();
    await expect(preview.locator("del")).toHaveText("Antigo");
    await page.keyboard.press("Escape");
    await page.goto(`/#/entrada?tarefa=${task.id}`);
    await expect(preview.locator("del")).toHaveText("Antigo");

    await detail.getByRole("button", { name: /^Concluir “/ }).click();
    await expect(detail.getByText("Tarefa concluída. Reabra para editar ou mover.")).toBeVisible();
    await expect(preview.locator("strong").last()).toHaveText("Novo");
    await expect(preview).not.toHaveAttribute("tabindex");
  });
}

import { expect, row, seedProject, test } from "./fixtures";

test.describe("telas do dia a dia", () => {
  test("cria pela captura rápida, conclui em Hoje e reabre no projeto", async ({ page, api, isMobile }) => {
    const title = `Comprar tinta ${Date.now()}`;
    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
    if (isMobile) await page.getByRole("button", { name: "Adicionar tarefa" }).click();
    else await page.keyboard.press("q");
    const dialog = page.getByRole("dialog", { name: "Adicionar tarefa" });
    await expect(dialog.getByLabel("Título da tarefa")).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Data" })).toHaveText("Hoje");
    await dialog.getByLabel("Título da tarefa").fill(title);
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Tarefa adicionada em Caixa de entrada/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row(page, title)).toBeVisible();

    await row(page, title).getByRole("button", { name: new RegExp(`^Concluir “${title}”`) }).click();
    await expect(page.getByRole("status").getByText("Concluída")).toBeVisible();
    await expect(row(page, title)).toBeHidden();

    await page.goto("/entrada");
    await expect(page.getByRole("heading", { name: "Caixa de entrada", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /Visualização/ }).click();
    await page.getByRole("switch", { name: "Mostrar concluídas" }).click();
    await page.keyboard.press("Escape");
    await row(page, title).getByRole("button", { name: new RegExp(`^Reabrir “${title}”`) }).click();
    await expect(page.getByRole("status").getByText("Tarefa reaberta")).toBeVisible();
  });

  test("edita no detalhe e encontra pela busca sem acento", async ({ page, api }) => {
    const seed = await seedProject(api, `Detalhe ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    await row(page, "Definir orçamento da reforma").locator(".t-click").click();
    const detail = page.getByRole("dialog", { name: /^Definir orçamento/ });
    await detail.getByLabel("Título").fill("Definir orçamento final");
    await detail.getByLabel("Título").press("Enter");
    await detail.getByRole("button", { name: "Prioridade: Prioridade 1" }).click();
    await page.getByRole("dialog", { name: "Prioridade" }).getByRole("option", { name: /Prioridade 2/ }).click();
    await expect(detail.getByRole("button", { name: "Prioridade: Prioridade 2" })).toBeVisible();
    await detail.getByRole("button", { name: "Adicionar data" }).click();
    await page.getByRole("dialog", { name: "Data" }).getByRole("button", { name: /Amanhã/ }).click();
    await expect(detail.getByRole("button", { name: "Amanhã" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row(page, "Definir orçamento final")).toContainText("P2");

    await page.goto("/busca");
    await page.getByLabel("Buscar tarefas por título ou descrição").fill("orcamento final");
    await expect(row(page, "Definir orçamento final")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "resultado" })).toContainText("1 resultado");
  });

  test("Em breve navega por semanas e Ajustes aplica o tema escuro", async ({ page }) => {
    await page.goto("/em-breve");
    await expect(page.getByRole("heading", { name: "Em breve", level: 1 })).toBeVisible();
    await expect(page.locator(".day-btn")).toHaveCount(7);
    await expect(page.getByRole("button", { name: "Semana anterior" })).toBeDisabled();
    await page.getByRole("button", { name: "Próxima semana" }).click();
    await expect(page.getByRole("button", { name: "Semana anterior" })).toBeEnabled();

    await page.goto("/ajustes");
    await page.getByRole("radio", { name: "Escuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("radio", { name: "Sistema" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Exportar" }).click();
    expect((await download).suggestedFilename()).toMatch(/^feito-dados-\d{4}-\d{2}-\d{2}\.json$/);
  });

  test("Ajustes escolhe o fuso horário pela busca", async ({ page }) => {
    await page.goto("/ajustes");
    const trigger = page.getByRole("button", { name: "Fuso horário do perfil" });
    const original = (await trigger.textContent()) ?? "";
    await trigger.click();
    const search = page.getByRole("combobox", { name: "Buscar fuso horário" });
    await expect(search).toBeFocused();
    await search.fill("kolkata");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option").first()).toContainText("UTC+5:30");
    await search.fill("utc+5:30");
    await expect(page.getByRole("option", { name: /Kolkata/ })).toBeVisible();
    await search.fill("sao paulo");
    await search.press("Enter");
    await expect(page.getByText("Fuso horário atualizado")).toBeVisible();
    await expect(trigger).toContainText("Sao Paulo");
    await expect(search).toBeHidden();

    await trigger.click();
    await page.getByRole("combobox", { name: "Buscar fuso horário" }).fill("zzz");
    await expect(page.getByText(/Nenhum fuso encontrado/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox", { name: "Buscar fuso horário" })).toBeHidden();
    if (!original.includes("Sao Paulo")) {
      await trigger.click();
      await page.getByRole("combobox", { name: "Buscar fuso horário" }).fill(original.replace(/UTC.*$/, "").trim());
      await page.keyboard.press("Enter");
    }
  });
});

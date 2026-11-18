import { expect, mouseDrag, projectState, row, seedProject, test } from "./fixtures";

test.describe("organizar um projeto", () => {
  test.skip(({ isMobile }) => isMobile, "Arraste com mouse");

  test("reordena, cria subtarefa e recusa destino inválido arrastando na Lista", async ({ page, api }) => {
    const seed = await seedProject(api, `Lista ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    await expect(row(page, "Listar móveis para doação")).toBeVisible();

    // Reordenar: soltar na borda superior de “Definir orçamento”.
    const source = await row(page, "Listar móveis para doação").boundingBox();
    const target = await row(page, "Definir orçamento da reforma").boundingBox();
    await mouseDrag(page, { x: source!.x + 200, y: source!.y + source!.height / 2 }, { x: target!.x + 200, y: target!.y + 4 });
    await expect(page.locator(".ins")).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole("status").getByText("Nova posição salva em Planejar")).toBeVisible();
    await expect.poll(async () => (await projectState(api, seed.id)).order(seed.sections.Planejar))
      .toEqual(["Listar móveis para doação", "Definir orçamento da reforma", "Escolher a cor da pintura do quarto"]);

    // Subtarefa: soltar no centro de uma raiz mostra destaque e prévia recuada.
    await row(page, "Kit de ferramentas").scrollIntoViewIfNeeded();
    const kit = await row(page, "Kit de ferramentas").boundingBox();
    const parent = await row(page, "Definir orçamento da reforma").boundingBox();
    await mouseDrag(page, { x: kit!.x + 200, y: kit!.y + kit!.height / 2 }, { x: parent!.x + 200, y: parent!.y + parent!.height / 2 },
      { locator: row(page, "Definir orçamento da reforma"), zone: "center" });
    await expect(row(page, "Definir orçamento da reforma")).toHaveClass(/nest-target/);
    await expect(page.locator(".nest-preview")).toContainText("Kit de ferramentas");
    await page.mouse.up();
    await expect.poll(async () => (await projectState(api, seed.id)).byTitle["Kit de ferramentas"].parentId)
      .toBe(seed.tasks["Definir orçamento da reforma"].id);
    await expect(row(page, "Kit de ferramentas")).toHaveClass(/sub/);

    // Inválido: soltar sobre uma subtarefa criaria um terceiro nível.
    await row(page, "Lâmpadas para o corredor").scrollIntoViewIfNeeded();
    const lamp = await row(page, "Lâmpadas para o corredor").boundingBox();
    const child = await row(page, "Pedir amostras na loja").boundingBox();
    await mouseDrag(page, { x: lamp!.x + 200, y: lamp!.y + lamp!.height / 2 }, { x: child!.x + 200, y: child!.y + child!.height / 2 },
      { locator: row(page, "Pedir amostras na loja"), zone: "center" });
    await expect(row(page, "Pedir amostras na loja")).toHaveClass(/invalid/);
    await expect(page.locator(".bad-tag")).toHaveText("Só um nível de subtarefa");
    await page.mouse.up();
    await expect(page.getByText(/Destino inválido/)).toBeVisible();
    expect((await projectState(api, seed.id)).byTitle["Lâmpadas para o corredor"].sectionId).toBe(seed.sections.Comprar);

    // Esc cancela e devolve a tarefa ao lugar.
    await row(page, "Lâmpadas para o corredor").scrollIntoViewIfNeeded();
    const again = await row(page, "Lâmpadas para o corredor").boundingBox();
    await mouseDrag(page, { x: again!.x + 200, y: again!.y + again!.height / 2 }, { x: again!.x + 200, y: again!.y - 140 });
    await expect(page.locator(".drag-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.getByText("Arraste cancelado — a tarefa voltou ao lugar")).toBeVisible();
    expect((await projectState(api, seed.id)).byTitle["Lâmpadas para o corredor"].sectionId).toBe(seed.sections.Comprar);
  });

  test("alterna Lista e Painel e muda a seção arrastando entre colunas", async ({ page, api }) => {
    const seed = await seedProject(api, `Painel ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    await page.getByRole("button", { name: "Visualização" }).click();
    const menu = page.getByRole("dialog", { name: "Visualização" });
    await expect(menu.getByRole("radio", { name: "Calendário" })).toBeDisabled();
    await menu.getByRole("radio", { name: "Painel" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Coluna Comprar" })).toBeVisible();
    await expect(page.locator("section.column")).toHaveCount(4);

    const card = await row(page, "Lâmpadas para o corredor").boundingBox();
    const column = await page.getByRole("region", { name: "Coluna Resolver" }).boundingBox();
    await mouseDrag(page, { x: card!.x + 100, y: card!.y + 15 }, { x: column!.x + column!.width / 2, y: column!.y + column!.height - 60 });
    await expect(page.getByText("Soltar aqui muda para Resolver")).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole("status").getByText("Movida para Resolver")).toBeVisible();
    await expect.poll(async () => (await projectState(api, seed.id)).byTitle["Lâmpadas para o corredor"].sectionId).toBe(seed.sections.Resolver);

    // O layout escolhido persiste e a Lista mostra a mesma organização.
    await page.reload();
    await expect(page.getByRole("region", { name: "Coluna Resolver" }).getByText("Lâmpadas para o corredor")).toBeVisible();
    await page.getByRole("button", { name: "Visualização" }).click();
    await page.getByRole("radio", { name: "Lista" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Resolver" }).getByText("Lâmpadas para o corredor")).toBeVisible();
  });

  test("teclado, menu e ordenação automática oferecem as mesmas operações", async ({ page, api }) => {
    const seed = await seedProject(api, `Teclado ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    await row(page, "Listar móveis para doação").locator(".t-click").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(async () => (await projectState(api, seed.id)).order(seed.sections.Planejar))
      .toEqual(["Definir orçamento da reforma", "Listar móveis para doação", "Escolher a cor da pintura do quarto"]);
    await expect(row(page, "Listar móveis para doação").locator(".t-click")).toBeFocused();
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await projectState(api, seed.id)).byTitle["Listar móveis para doação"].parentId)
      .toBe(seed.tasks["Definir orçamento da reforma"].id);
    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(async () => (await projectState(api, seed.id)).byTitle["Listar móveis para doação"].parentId).toBeNull();

    // Menu ⋯ → Mover para… outra seção.
    await row(page, "Kit de ferramentas").getByRole("button", { name: /Ações de/ }).click();
    await page.getByRole("menuitem", { name: "Mover para…" }).click();
    const dialog = page.getByRole("dialog", { name: "Mover para…" });
    await dialog.getByRole("option", { name: new RegExp(`^${"Teclado"}`) }).first().click();
    await dialog.getByRole("option", { name: "Resolver" }).click();
    await expect.poll(async () => (await projectState(api, seed.id)).byTitle["Kit de ferramentas"].sectionId).toBe(seed.sections.Resolver);

    // Ordenação automática: sem arraste por posição; voltar a Manual recupera a ordem.
    await page.getByRole("button", { name: "Visualização" }).click();
    await page.getByLabel("Ordenar").selectOption("priority");
    await page.keyboard.press("Escape");
    await expect(page.getByText(/reordenar por posição está desativado/)).toBeVisible();
    await expect(row(page, "Definir orçamento da reforma")).not.toHaveAttribute("aria-disabled", "false");
    await row(page, "Escolher a cor da pintura do quarto").locator(".t-click").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(page.getByText("Reordenar só funciona na ordenação Manual")).toBeVisible();
    await page.getByRole("button", { name: "Voltar a Manual" }).click();
    await expect(page.getByText(/reordenar por posição está desativado/)).toBeHidden();
  });
});

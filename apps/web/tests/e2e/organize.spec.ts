import { expect, mouseDrag, projectState, row, seedProject, test } from "./fixtures";

test.describe("organizar um projeto", () => {
  test.skip(({ isMobile }) => isMobile, "Arraste com mouse");

  test("salva a edição em linha e a mudança de projeto na mesma revisão", async ({ page, api }) => {
    const project = await api<{ id: string }>("POST", "/projects", { name: "Projeto da edição em linha" });
    const { inbox } = await api<{ inbox: { projectId: string } }>("GET", "/navigation");
    const task = await api<{ id: string; revision: number }>("POST", "/tasks", {
      title: "Título original", projectId: project.id,
    });
    await page.goto(`/projetos/${project.id}`);
    const taskRow = row(page, "Título original");
    await taskRow.hover();
    await taskRow.getByRole("button", { name: "Editar “Título original”" }).click();

    const editor = page.getByRole("form", { name: "Salvar" });
    await editor.getByRole("textbox", { name: "Título da tarefa" }).fill("Título atualizado");
    await editor.getByRole("button", { name: "Projeto", exact: true }).click();
    await page.getByRole("listbox", { name: "Destino" }).getByRole("option", { name: "Entrada" }).click();
    await editor.getByRole("button", { name: "Salvar" }).click();

    await expect(page.getByRole("status").getByText("Tarefa atualizada")).toBeVisible();
    await expect.poll(() => api("GET", `/tasks/${task.id}`)).toMatchObject({
      title: "Título atualizado", projectId: inbox.projectId, revision: task.revision + 1,
    });
  });

  test("reordena abrindo espaço e cria subtarefa arrastando para a direita na Lista", async ({ page, api }) => {
    const seed = await seedProject(api, `Lista ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    await expect(row(page, "Listar móveis para doação")).toBeVisible();

    // Reordenar: na metade de cima de “Definir orçamento”, ela desce para abrir o espaço com a barra.
    const budget = row(page, "Definir orçamento da reforma");
    const source = await row(page, "Listar móveis para doação").boundingBox();
    const target = (await budget.boundingBox())!;
    await mouseDrag(page, { x: source!.x + 200, y: source!.y + source!.height / 2 }, { x: source!.x + 200, y: target.y + 4 });
    const gap = page.locator(".drop-gap[data-open]");
    await expect(gap).toHaveCount(1);
    await expect(gap.locator(".ins")).toBeVisible();
    await expect.poll(async () => (await budget.boundingBox())!.y).toBeGreaterThan(target.y + target.height / 2);
    await page.mouse.up();
    await expect(page.getByRole("status").getByText("Nova posição salva em Planejar")).toBeVisible();
    await expect.poll(async () => (await projectState(api, seed.id)).order(seed.sections.Planejar))
      .toEqual(["Listar móveis para doação", "Definir orçamento da reforma", "Escolher a cor da pintura do quarto"]);
    await expect(page.locator(".drop-gap")).toHaveCount(0);

    // As notificações podem cobrir o ponto de partida perto do rodapé.
    const toasts = page.getByRole("status").locator(".toast");
    await expect(toasts).toHaveCount(0);
    // Passar por cima de outra tarefa só reordena; a subtarefa vem do deslocamento para a direita.
    await row(page, "Kit de ferramentas").scrollIntoViewIfNeeded();
    const kit = (await row(page, "Kit de ferramentas").boundingBox())!;
    const samples = row(page, "Pedir amostras na loja");
    const sample = (await samples.boundingBox())!;
    const start = { x: kit.x + 200, y: kit.y + kit.height / 2 };
    await mouseDrag(page, start, { x: start.x, y: sample.y + sample.height / 2 });
    await expect(samples).not.toHaveClass(/nest-target/);
    await expect(gap).toHaveCount(1);
    // Logo abaixo de “Pedir amostras”, dois níveis à direita: subtarefa dela.
    const below = (await samples.boundingBox())!;
    await page.mouse.move(start.x + 45, below.y + below.height + 4, { steps: 6 });
    await expect(page.getByRole("region", { name: "Planejar" }).locator(".drop-gap[data-open] .ins"))
      .toHaveAttribute("style", /--task-depth: ?2/);
    await page.mouse.up();
    await expect.poll(async () => (await projectState(api, seed.id)).byTitle["Kit de ferramentas"].parentId)
      .toBe(seed.tasks["Pedir amostras na loja"].id);
    await expect(row(page, "Kit de ferramentas")).toHaveClass(/sub/);
    await expect(toasts).toHaveCount(0);

    // Esc cancela e devolve a tarefa ao lugar.
    await expect(toasts).toHaveCount(0);
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
    await page.getByRole("button", { name: /^Mostrar/ }).click();
    const menu = page.getByRole("dialog", { name: "Visualização" });
    await expect(menu.getByRole("radio", { name: "Calendário" })).toBeEnabled();
    await expect(menu.getByRole("radio", { name: "Tabela" })).toBeEnabled();
    await menu.getByRole("radio", { name: "Painel" }).click();
    await expect.poll(async () => (await api<{ project: { view: { layout: string } } }>("GET", `/projects/${seed.id}`)).project.view.layout).toBe("board");
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
    await page.getByRole("button", { name: /^Mostrar/ }).click();
    await page.getByRole("radio", { name: "Lista" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Resolver" }).getByText("Lâmpadas para o corredor")).toBeVisible();
  });

  for (const layout of ["list", "board"]) {
    test(`arrasta só a subtarefa para outra seção em ${layout}`, async ({ page, api }) => {
      const seed = await seedProject(api, `Subtarefa ${layout} ${Date.now()}`);
      await api("PATCH", `/projects/${seed.id}/view`, { layout });
      await page.goto(`/projetos/${seed.id}`);
      const childTitle = "Pedir amostras na loja";
      const parentTitle = "Escolher a cor da pintura do quarto";
      const child = row(page, childTitle);
      await child.scrollIntoViewIfNeeded();

      const source = (await child.boundingBox())!;
      const target = row(page, "Lâmpadas para o corredor");
      const destination = (await target.boundingBox())!;
      await mouseDrag(page, { x: source.x + 100, y: source.y + 15 },
        { x: destination.x + 100, y: destination.y + destination.height / 2 }, { locator: target, zone: "center" });
      await expect(page.locator(".drag-overlay")).toContainText(childTitle);
      await expect(page.getByRole("region", { name: layout === "board" ? "Coluna Comprar" : "Comprar" }))
        .toHaveClass(layout === "board" ? /\btarget\b/ : /\bover\b/);
      await page.mouse.up();

      await expect.poll(async () => (await projectState(api, seed.id)).byTitle[childTitle])
        .toMatchObject({ parentId: null, sectionId: seed.sections.Comprar });
      const saved = await projectState(api, seed.id);
      expect(saved.byTitle[parentTitle]).toMatchObject({ sectionId: seed.sections.Planejar, childIds: [] });
      expect(saved.order(seed.sections.Comprar)).toContain(childTitle);
      await expect(child).not.toHaveClass(/\bsub\b/);
    });
  }

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
    await page.getByRole("button", { name: /^Mostrar/ }).click();
    await page.getByRole("button", { name: "Ordenar Manual" }).click();
    await page.getByRole("listbox", { name: "Ordenar tarefas" }).getByRole("option", { name: "Prioridade" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByText(/reordenar por posição está desativado/)).toBeVisible();
    await row(page, "Escolher a cor da pintura do quarto").locator(".t-click").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(page.getByText("Reordenar só funciona na ordenação Manual")).toBeVisible();
    await page.getByRole("button", { name: "Voltar a Manual" }).click();
    await expect(page.getByText(/reordenar por posição está desativado/)).toBeHidden();
  });
});

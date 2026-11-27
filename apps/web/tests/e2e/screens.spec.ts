import { expect, projectState, row, seedProject, test } from "./fixtures";

test.describe("telas do dia a dia", () => {
  for (const layout of ["list", "board"] as const) {
    test(`rola o título e a descrição junto com as tarefas em ${layout}`, async ({ page, api, isMobile }) => {
      const name = "Oficina";
      const { id } = await api<{ id: string }>("POST", "/projects", {
        name, description: "Descrição do projeto longo.", color: "violeta", icon: "star",
      });
      await api("PATCH", `/projects/${id}/view`, { layout });
      for (let index = 1; index <= 25; index++) {
        await api("POST", "/tasks", { projectId: id, title: `Tarefa ${index}` });
      }
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`/projetos/${id}`);

      const title = page.getByRole("heading", { name, level: 1 });
      const description = page.getByRole("button", { name: "Editar descrição do projeto" });
      const toolbar = page.locator(isMobile ? ".m-top" : ".topbar");
      const compactTitle = toolbar.locator(".compact-title");
      const fadeDuration = () => compactTitle.evaluate((element) =>
        element.getAnimations().find((animation) =>
          animation instanceof CSSTransition && animation.transitionProperty === "opacity")?.effect?.getTiming().duration);
      await expect(title).toBeInViewport();
      await expect(description).toBeInViewport();
      await expect(compactTitle).toBeHidden();

      const lastTask = row(page, "Tarefa 25");
      await lastTask.scrollIntoViewIfNeeded();
      await expect.poll(fadeDuration, { intervals: [16, 32, 50] }).toBe(500);
      await expect(compactTitle).toHaveCSS("opacity", "1");
      await expect(lastTask).toBeInViewport();
      await expect(title).not.toBeInViewport();
      await expect(description).not.toBeInViewport();
      await expect(compactTitle).toBeVisible();
      await expect(compactTitle).toHaveText(name);
      await expect(compactTitle.locator("svg")).toHaveCSS("color", "rgb(110, 69, 201)");
      const center = (box: { x: number; width: number }) => box.x + box.width / 2;
      expect(Math.abs(center((await compactTitle.boundingBox())!) - center((await toolbar.boundingBox())!))).toBeLessThan(2);

      await title.scrollIntoViewIfNeeded();
      await expect.poll(fadeDuration, { intervals: [16, 32, 50] }).toBe(500);
      await expect(title).toBeInViewport();
      await expect(compactTitle).toBeHidden();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(compactTitle).toHaveCSS("transition-property", "none");
    });
  }

  for (const layout of ["list", "board"] as const) {
    test(`recolhe e mostra as subtarefas pela seta de cada nível em ${layout}`, async ({ page, api }) => {
      const project = await api<{ id: string }>("POST", "/projects", { name: `Subtarefas recolhíveis ${layout}` });
      await api("PATCH", `/projects/${project.id}/view`, { layout });
      const root = await api<{ id: string }>("POST", "/tasks", { projectId: project.id, title: "Mudança" });
      const child = await api<{ id: string }>("POST", "/tasks", { parentId: root.id, title: "Caixas" });
      await api("POST", "/tasks", { parentId: child.id, title: "Fita" });
      await api("POST", "/tasks", { projectId: project.id, title: "Sem filhos" });
      await page.goto(`/projetos/${project.id}`);

      const collapseRoot = row(page, "Mudança").getByRole("button", { name: "Recolher subtarefas de “Mudança”" });
      const collapseChild = row(page, "Caixas").getByRole("button", { name: "Recolher subtarefas de “Caixas”" });
      await expect(collapseRoot).toHaveAttribute("aria-expanded", "true");
      await expect(collapseChild).toBeVisible();
      await expect(row(page, "Fita").getByRole("button", { name: /subtarefas de/ })).toHaveCount(0);
      await expect(row(page, "Sem filhos").getByRole("button", { name: /subtarefas de/ })).toHaveCount(0);

      await collapseChild.click();
      await expect(row(page, "Fita")).toHaveCount(0);
      await expect(row(page, "Caixas").getByRole("button", { name: "Mostrar subtarefas de “Caixas”" })).toHaveAttribute("aria-expanded", "false");

      await collapseRoot.click();
      await expect(row(page, "Caixas")).toHaveCount(0);
      const expandRoot = row(page, "Mudança").getByRole("button", { name: "Mostrar subtarefas de “Mudança”" });
      await expandRoot.click();
      // Cada nível guarda o próprio estado: Caixas volta ainda recolhida.
      await expect(row(page, "Caixas")).toBeVisible();
      await expect(row(page, "Fita")).toHaveCount(0);
      await row(page, "Caixas").getByRole("button", { name: "Mostrar subtarefas de “Caixas”" }).click();
      await expect(row(page, "Fita")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/projetos/${project.id}$`));
    });
  }

  test("exibe cinco níveis e navega pelas subtarefas profundas no detalhe", async ({ page, api, isMobile }) => {
    const project = await api<{ id: string }>("POST", "/projects", { name: "Projeto com subtarefas aninhadas" });
    let parent = await api<{ id: string }>("POST", "/tasks", { projectId: project.id, title: "Tarefa raiz" });
    for (let depth = 1; depth <= 7; depth++) {
      parent = await api<{ id: string }>("POST", "/tasks", { parentId: parent.id, title: `Nível ${depth}` });
    }
    await page.goto(`/projetos/${project.id}`);
    const inset = (title: string) => row(page, title).evaluate((element) => parseFloat(getComputedStyle(element).paddingInlineStart));
    await expect(row(page, "Nível 5")).toBeVisible();
    expect(await inset("Nível 5")).toBeGreaterThan(await inset("Nível 4"));
    await expect(row(page, "Nível 6")).toHaveCount(0);

    const last = row(page, "Nível 5");
    if (isMobile) await last.getByText("Ver subtarefas").click();
    else await last.getByRole("button", { name: "Ver subtarefas" }).click();
    const level5 = page.getByRole("dialog", { name: "Nível 5" });
    await expect(level5.getByText("Nível 7")).toHaveCount(0);
    await level5.getByRole("button", { name: /^Nível 6/ }).click();
    const level6 = page.getByRole("dialog", { name: "Nível 6" });
    await level6.getByRole("button", { name: /^Nível 7/ }).click();
    const level7 = page.getByRole("dialog", { name: "Nível 7" });
    await expect(level7.getByRole("textbox", { name: "Título" })).toBeFocused();
    await level7.getByRole("button", { name: "Adicionar subtarefa" }).click();
    const add = page.getByRole("dialog", { name: "Adicionar tarefa" });
    await add.getByRole("textbox", { name: "Título da tarefa" }).fill("Nível 8");
    await add.getByRole("button", { name: "Adicionar tarefa" }).click();
    await expect.poll(async () => (await projectState(api, project.id)).byTitle["Nível 8"]?.parentId).toBe(parent.id);
    await add.getByRole("button", { name: "Cancelar" }).click();
    await expect(level7.getByRole("button", { name: /^Nível 8/ })).toBeVisible();
    await level7.getByRole("button", { name: "Tarefa-pai: Nível 6" }).click();
    await expect(level6.getByRole("textbox", { name: "Título" })).toHaveValue("Nível 6");
    await level6.getByRole("button", { name: "Fechar (Esc)" }).click();

    await api("PATCH", `/projects/${project.id}/view`, { layout: "board" });
    await page.reload();
    await expect(page.locator(".board")).toBeVisible();
    await expect(row(page, "Nível 5")).toBeVisible();
    await expect(row(page, "Nível 6")).toHaveCount(0);
    const offset = (title: string) => row(page, title).evaluate((element) => parseFloat(getComputedStyle(element).marginInlineStart));
    expect(await offset("Nível 5")).toBeGreaterThan(await offset("Nível 4"));
  });

  test("adiciona seção inline no painel e edita a descrição do projeto", async ({ page, api, isMobile }) => {
    await page.goto(isMobile ? "/navegar" : "/hoje");
    await page.getByRole("button", { name: "Novo projeto" }).click();
    const create = page.getByRole("dialog", { name: "Novo projeto" });
    await create.getByRole("textbox", { name: "Nome do projeto" }).fill("Reforma");
    await create.getByRole("textbox", { name: "Descrição do projeto" }).fill("Organizar a reforma.");
    await create.getByRole("button", { name: "Criar projeto" }).click();
    await page.waitForURL("**/projetos/*");
    const projectId = new URL(page.url()).pathname.split("/").at(-1);
    await expect.poll(async () => (await page.request.get(`/api/v1/projects/${projectId}`)).status()).toBe(200);
    await api("POST", "/tasks", { projectId, title: "Medir a sala" });
    await page.reload();
    const title = page.getByRole("heading", { name: "Reforma", level: 1 }).getByRole("button");
    const description = page.getByRole("button", { name: "Editar descrição do projeto" });
    await expect(description).toHaveText("Organizar a reforma.");
    const taskWidth = await row(page, "Medir a sala").evaluate((el) => getComputedStyle(el).width);
    await expect(title).toHaveCSS("width", taskWidth);
    await expect(description).toHaveCSS("width", taskWidth);
    if (!isMobile) {
      for (const field of [title, description]) {
        await field.hover();
        await expect(field).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
        await expect(field).toHaveCSS("border-top-color", await field.evaluate((el) => getComputedStyle(el).borderRightColor));
      }
    }
    await title.click();
    const name = page.getByRole("textbox", { name: "Nome do projeto" });
    await expect(name).toBeFocused();
    await expect(name).toHaveCSS("width", taskWidth);
    await expect(name).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await name.fill("Reforma do apartamento");
    await name.press("Enter");
    await expect.poll(async () => (await api<{ project: { name: string } }>("GET", `/projects/${projectId}`)).project.name).toBe("Reforma do apartamento");
    const renamed = page.getByRole("heading", { name: "Reforma do apartamento", level: 1 });
    await expect(renamed).toBeVisible();
    await api("PATCH", `/projects/${projectId}/view`, { layout: "board" });
    await page.reload();

    const board = page.locator(".board");
    await board.getByRole("button", { name: "Adicionar seção" }).click();
    const sectionName = board.getByRole("textbox", { name: "Nome da seção" });
    await expect(sectionName).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await sectionName.fill("Compras");
    await board.getByRole("textbox", { name: "Descrição da seção" }).fill("Pesquisar preços.");
    await board.getByRole("button", { name: "Adicionar seção" }).click();
    await expect(board.getByRole("region", { name: "Coluna Compras" })).toContainText("Pesquisar preços.");

    await page.getByRole("button", { name: "Mais ações" }).click();
    await page.getByRole("menuitem", { name: "Editar projeto" }).click();
    const edit = page.getByRole("dialog", { name: "Editar projeto" });
    await expect(edit.getByRole("textbox", { name: "Descrição do projeto" })).toHaveValue("Organizar a reforma.");
    await edit.getByRole("textbox", { name: "Descrição do projeto" }).clear();
    await edit.getByRole("button", { name: "Salvar" }).click();

    const addDescription = page.getByRole("button", { name: "Adicionar uma descrição" });
    const descriptionWidth = await addDescription.evaluate((el) => getComputedStyle(el).width);
    await addDescription.click();
    const descriptionField = page.getByRole("textbox", { name: "Descrição do projeto" });
    await expect(descriptionField).toHaveCSS("width", descriptionWidth);
    await expect(descriptionField).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await descriptionField.fill("Comprar materiais.");
    await expect(page.locator(".project-heading-fields").getByRole("button", { name: /^(Salvar|Cancelar)$/ })).toHaveCount(0);
    await descriptionField.press("Tab");
    await expect.poll(async () => (await api<{ project: { description: string } }>("GET", `/projects/${projectId}`)).project.description).toBe("Comprar materiais.");
    await expect(page.getByRole("button", { name: "Editar descrição do projeto" })).toHaveText("Comprar materiais.");
    await page.reload();
    await expect(renamed).toBeVisible();
    await expect(page.getByRole("button", { name: "Editar descrição do projeto" })).toHaveText("Comprar materiais.");
    await expect(board.getByRole("region", { name: "Coluna Compras" })).toContainText("Pesquisar preços.");
  });

  test("renomeia seções no Painel e só exibe um título na Lista quando há nome", async ({ page, api }) => {
    const { id } = await api<{ id: string }>("POST", "/projects", { name: "Seções editáveis" });
    await api("POST", `/projects/${id}/sections`, { name: "Compras", description: "Pesquisar preços." });
    await api("POST", "/tasks", { projectId: id, title: "Revisar o orçamento" });
    await page.goto(`/projetos/${id}`);

    const list = page.locator(".content");
    await expect(list.getByRole("button", { name: "Compras", exact: true })).toBeVisible();
    await expect(list.getByText("Revisar o orçamento")).toBeVisible();
    await expect(list.getByText(/^(Sem seção|\(Nenhuma seção\))$/)).toHaveCount(0);

    await api("PATCH", `/projects/${id}/view`, { layout: "board" });
    await page.reload();
    const board = page.locator(".board");
    const editor = board.getByRole("textbox", { name: "Nome da seção" });
    await board.getByRole("button", { name: "(Nenhuma seção)", exact: true }).click();
    await expect(editor).toHaveValue("");
    await editor.fill("Entrada");
    await editor.press("Enter");
    await expect(board.getByRole("region", { name: "Coluna Entrada" })).toContainText("Revisar o orçamento");

    await board.getByRole("button", { name: "Compras", exact: true }).click();
    await editor.fill("Nome descartado");
    await editor.press("Escape");
    await expect(board.getByRole("button", { name: "Compras", exact: true })).toBeFocused();
    await board.getByRole("button", { name: "Compras", exact: true }).click();
    await editor.fill("Cotações");
    await editor.press("Tab");
    await expect(board.getByRole("region", { name: "Coluna Cotações" })).toContainText("Pesquisar preços.");

    await api("PATCH", `/projects/${id}/view`, { layout: "list" });
    await page.reload();
    await expect(list.getByRole("region", { name: "Entrada" })).toContainText("Revisar o orçamento");
    await expect(list.getByRole("button", { name: "Cotações", exact: true })).toBeVisible();

    await list.getByRole("button", { name: "Entrada", exact: true }).click();
    const listEditor = list.getByRole("textbox", { name: "Nome da seção" });
    await listEditor.clear();
    await listEditor.press("Enter");
    await expect(list.getByRole("region", { name: "Tarefas do projeto" })).toContainText("Revisar o orçamento");
    await expect(list.getByRole("button", { name: "Entrada", exact: true })).toHaveCount(0);
  });

  test("cria pela captura rápida, conclui em Hoje e reabre no projeto", async ({ page, api, isMobile }) => {
    const title = `Comprar tinta ${Date.now()}`;
    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
    if (isMobile) await page.getByRole("button", { name: "Adicionar tarefa", exact: true }).click();
    else await page.keyboard.press("q");
    const dialog = page.getByRole("dialog", { name: "Adicionar tarefa" });
    await expect(dialog.getByLabel("Título da tarefa")).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Data" })).toContainText("Hoje");
    await dialog.getByLabel("Título da tarefa").fill(title);
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Tarefa adicionada em Entrada/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row(page, title)).toBeVisible();

    await row(page, title).getByRole("button", { name: new RegExp(`^Concluir “${title}”`) }).click();
    await expect(page.getByRole("status").getByText("Concluída")).toBeVisible();
    await expect(row(page, title)).toBeHidden();

    await page.goto("/entrada");
    await expect(page.getByRole("heading", { name: "Entrada", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /Mostrar/ }).click();
    await page.getByRole("switch", { name: "Mostrar concluídas" }).click();
    await page.keyboard.press("Escape");
    await row(page, title).getByRole("button", { name: new RegExp(`^Reabrir “${title}”`) }).click();
    await expect(page.getByRole("status").getByText("Tarefa reaberta")).toBeVisible();
  });

  test("abre o detalhe pela descrição, edita e encontra pela busca sem acento", async ({ page, api }) => {
    const seed = await seedProject(api, `Detalhe ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    await row(page, "Definir orçamento da reforma").getByText("Teto de R$ 8 mil", { exact: true }).click();
    const detail = page.getByRole("dialog", { name: /^Definir orçamento/ });
    await expect(detail.getByRole("region", { name: "Descrição", exact: true })).toHaveText("Teto de R$ 8 mil");
    await detail.getByLabel("Título").fill("Definir orçamento final");
    await detail.getByLabel("Título").press("Enter");
    await detail.getByRole("button", { name: "Prioridade: Prioridade 1" }).click();
    await page.getByRole("dialog", { name: "Prioridade" }).getByRole("option", { name: /Prioridade 2/ }).click();
    await expect(detail.getByRole("button", { name: "Prioridade: Prioridade 2" })).toBeVisible();
    await detail.getByRole("button", { name: "Adicionar data" }).click();
    await page.getByRole("dialog", { name: "Data" }).getByRole("button", { name: /Amanhã/ }).click();
    await expect(detail.getByRole("button", { name: "Amanhã" })).toBeVisible();
    await page.keyboard.press("Escape");
    const updated = row(page, "Definir orçamento final");
    await expect(updated.getByRole("button", { name: /prioridade 2$/ })).toBeVisible();
    await expect(updated).not.toContainText("P2");

    await page.goto("/busca");
    await page.getByLabel("Buscar tarefas por título ou descrição").fill("orcamento final");
    await expect(row(page, "Definir orçamento final")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "resultado" })).toContainText("1 resultado");
  });

  test("abre seletores pelos campos da tarefa no desktop e o detalhe pelo toque", async ({ page, api, isMobile }) => {
    const project = await api<{ id: string }>("POST", "/projects", { name: `Campos ${Date.now()}` });
    const { referenceDate } = await api<{ referenceDate: string }>("GET", "/views/today");
    const title = "Conferir medidas";
    await api("POST", "/tasks", { projectId: project.id, title, dueDate: referenceDate, priority: 2 });

    for (const layout of ["list", "board"]) {
      await api("PATCH", `/projects/${project.id}/view`, { layout });
      await page.goto(`/projetos/${project.id}`);
      const task = row(page, title);
      await expect(task).toHaveClass(layout === "board" ? /\bcard\b/ : /\btask\b/);
      // A prioridade aparece só pela cor do círculo, sem o nome escrito na tarefa.
      await expect(task.locator(".chk")).toHaveClass(/\bp2\b/);
      await expect(task).not.toContainText("P2");
      const detail = page.getByRole("dialog", { name: title, exact: true });
      const date = page.getByRole("dialog", { name: "Data", exact: true });
      if (isMobile) {
        await task.locator(".m-date").filter({ hasText: "Hoje" }).tap();
        await expect(detail).toBeVisible();
        await expect(date).toHaveCount(0);
        continue;
      }
      const dateButton = task.getByRole("button", { name: "Data: Hoje" });
      await dateButton.click();
      await expect(date.getByLabel("Digite um vencimento")).toBeFocused();
      await expect(detail).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dateButton).toBeFocused();
    }
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
    await expect(page.getByRole("radio", { name: "Escuro" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("radio", { name: "Sistema" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar", exact: true }).click();
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
    await search.fill("calcutta");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option", { name: /Kolkata/ })).toBeVisible();
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

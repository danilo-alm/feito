import type { Label, TaskDetail } from "@feito/core/types";
import { expect, row, test } from "./fixtures";

test.describe("recuperação e concorrência na interface", () => {
  test("repete a preparação da cópia local após falha de sincronização", async ({ page, api }) => {
    await page.route("**/api/v1/product-events", (route) => route.abort());
    const { referenceDate } = await api<{ referenceDate: string }>("GET", "/views/today");
    const { title } = await api<TaskDetail>("POST", "/tasks", { title: "Retomar depois da falha", dueDate: referenceDate });
    await page.route("**/api/v1/desktop-sync*", (route) => route.fulfill({
      status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "Agenda temporariamente indisponível." } },
    }), { times: 1 });

    await page.goto("/hoje");
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toHaveText("Agenda temporariamente indisponível.");
    await page.getByRole("button", { name: /Try again|Tentar de novo/ }).click();
    await expect(row(page, title)).toBeVisible();
    await expect(alert).toHaveCount(0);
  });

  test("recupera o canal de revisão e mostra mudanças remotas com a aba aberta", async ({ page, api }) => {
    const seed = (title: string) => api<TaskDetail>("POST", "/tasks", { title });
    const initial = await seed("Tarefa anterior ao canal de avisos");
    const release = Promise.withResolvers<void>();
    await page.route("**/api/v1/product-events", async (route) => {
      await release.promise;
      await route.fulfill({ status: 503 });
    }, { times: 1 });

    let missed: TaskDetail;
    try {
      await page.goto("/entrada");
      await expect(row(page, initial.title)).toBeVisible();
      missed = await seed("Tarefa criada com o canal indisponível");
      await expect(row(page, missed.title)).toHaveCount(0);
    } finally {
      release.resolve();
    }

    await expect(row(page, missed.title)).toBeVisible();
    const live = await seed("Tarefa criada com o canal aberto");
    await expect(row(page, live.title)).toBeVisible();
  });

  test("preserva a descrição em edição enquanto recebe outra revisão", async ({ page, api }) => {
    const task = await api<TaskDetail>("POST", "/tasks", { title: "Revisar relatório", description: "Antes da edição" });
    await page.goto("/entrada");
    await row(page, task.title).getByRole("button", { name: /^Revisar relatório/ }).click();
    const detail = page.getByRole("dialog", { name: task.title, exact: true });
    await detail.getByRole("region", { name: "Descrição", exact: true }).click();
    const description = detail.getByRole("textbox", { name: "Descrição", exact: true });
    await description.fill("Meu rascunho");

    await api("PATCH", `/tasks/${task.id}`, { revision: task.revision, priority: 1 });
    await expect(detail.getByRole("button", { name: /^Prioridade:/ })).toHaveText("P1");
    await expect(description).toHaveValue("Meu rascunho");
    // O Tab leva à barra de formatação, ainda dentro da descrição; mover o foco para fora confirma a edição.
    await detail.getByRole("button", { name: /^Prioridade:/ }).focus();

    await expect.poll(() => api<TaskDetail>("GET", `/tasks/${task.id}`))
      .toMatchObject({ description: "Meu rascunho", priority: 1 });
  });

  test("aplica etiquetas em sequência e mantém o foco durante a atualização", async ({ page, api }) => {
    const [first, second] = await Promise.all([
      api<Label>("POST", "/labels", { name: "Primeira etiqueta" }),
      api<Label>("POST", "/labels", { name: "Segunda etiqueta" }),
    ]);
    const task = await api<TaskDetail>("POST", "/tasks", { title: "Classificar revisão" });
    const firstPatch = Promise.withResolvers<void>();
    const resumePatch = Promise.withResolvers<void>();
    let edits = 0;
    await page.route("**/api/v1/desktop-sync*", async (route) => {
      const operation = route.request().method() === "POST" ? route.request().postDataJSON() as { method: string; path: string } : undefined;
      if (operation?.method === "PATCH" && operation.path === `/tasks/${task.id}` && ++edits === 1) {
        firstPatch.resolve();
        await resumePatch.promise;
      }
      await route.continue();
    });

    await page.goto("/entrada");
    await row(page, task.title).getByRole("button", { name: task.title, exact: true }).click();
    const detail = page.getByRole("dialog", { name: task.title, exact: true });
    // No celular o nome do botão passa a listar as etiquetas aplicadas.
    const trigger = detail.getByRole("button", { name: /^Etiquetas: / });
    await trigger.click();
    await expect(page.getByRole("textbox", { name: "Buscar ou criar etiqueta" })).toBeFocused();
    const options = page.getByRole("listbox", { name: "Etiquetas" });
    const firstOption = options.getByRole("option", { name: first.name, exact: true });
    const secondOption = options.getByRole("option", { name: second.name, exact: true });
    await firstOption.press("Enter");
    try {
      await firstPatch.promise;
      await secondOption.press("Enter");
      await expect(firstOption).toHaveAttribute("aria-selected", "true");
      await expect(secondOption).toHaveAttribute("aria-selected", "true");
      await expect(secondOption).toBeFocused();
    } finally {
      resumePatch.resolve();
    }

    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect.poll(async () => {
      const persisted = await api<TaskDetail>("GET", `/tasks/${task.id}`);
      return persisted.labels.map(({ id }) => id).sort();
    }).toEqual([first.id, second.id].sort());
  });

  test("pagina a busca local e isola os resultados ao trocar o texto", async ({ page, api }) => {
    const stamp = Date.now().toString();
    const original = `Original${stamp}`;
    const next = `Nova${stamp}`;
    // Mais de uma página real por critério: não há resposta HTTP de busca no modo local.
    for (let offset = 0; offset < 51; offset += 3) {
      await Promise.all(Array.from({ length: 3 }, (_, index) => offset + index).flatMap((index) =>
        [original, next].map((text) => api("POST", "/tasks", { title: `${text} · tarefa ${index}` }))));
    }
    await page.goto("/busca");
    const input = page.getByRole("searchbox", { name: "Buscar tarefas por título ou descrição" });
    const loadMore = page.getByRole("button", { name: "Carregar mais" });
    const results = (text: string) => page.locator("[data-task-id]", { has: page.locator(".t-title", { hasText: text }) });
    await input.fill(original);
    await expect(results(original)).toHaveCount(50);
    await loadMore.click();
    await expect(results(original)).toHaveCount(51);
    await expect(loadMore).toHaveCount(0);

    await input.fill(next);
    await expect(results(next)).toHaveCount(50);
    await expect(results(original)).toHaveCount(0);
    await loadMore.click();
    await expect(results(next)).toHaveCount(51);
    await expect(results(original)).toHaveCount(0);
    await expect(loadMore).toHaveCount(0);
  });
});

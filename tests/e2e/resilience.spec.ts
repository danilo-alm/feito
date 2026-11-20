import type { Locator } from "@playwright/test";
import type { Label, SearchInput, SearchResult, TaskDetail } from "@/client/types";
import { expect, row, test } from "./fixtures";

test.describe("recuperação e concorrência na interface", () => {
  test("repete uma leitura de Hoje que falhou", async ({ page, api }) => {
    const { referenceDate } = await api<{ referenceDate: string }>("GET", "/views/today");
    const { title } = await api<TaskDetail>("POST", "/tasks", { title: "Retomar depois da falha", dueDate: referenceDate });
    await page.route("**/api/v1/views/today", (route) => route.fulfill({
      status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "Agenda temporariamente indisponível." } },
    }), { times: 1 });

    await page.goto("/hoje");
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toHaveText("Agenda temporariamente indisponível.");
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(row(page, title)).toBeVisible();
    await expect(alert).toHaveCount(0);
  });

  test("preserva a descrição em edição enquanto recebe outra revisão", async ({ page, api }) => {
    const task = await api<TaskDetail>("POST", "/tasks", { title: "Revisar relatório", description: "Antes da edição" });
    await page.goto("/entrada");
    await row(page, task.title).getByRole("button", { name: /^Revisar relatório/ }).click();
    const detail = page.getByRole("dialog", { name: task.title, exact: true });
    const description = detail.getByRole("textbox", { name: "Descrição", exact: true });
    await description.fill("Meu rascunho");

    await api("PATCH", `/tasks/${task.id}`, { revision: task.revision, priority: 1 });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(detail.getByRole("button", { name: /^Prioridade:/ })).toHaveText("P1");
    await expect(description).toHaveValue("Meu rascunho");
    await description.press("Tab");

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
    await page.route(`**/api/v1/tasks/${task.id}`, async (route) => {
      if (route.request().method() === "PATCH" && ++edits === 1) {
        firstPatch.resolve();
        await resumePatch.promise;
      }
      await route.continue();
    });

    await page.goto("/entrada");
    await row(page, task.title).getByRole("button", { name: task.title, exact: true }).click();
    const detail = page.getByRole("dialog", { name: task.title, exact: true });
    const trigger = detail.getByRole("button", { name: "Etiquetas: adicionar etiqueta" });
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

  test("isola as páginas de resultados ao trocar a busca", async ({ page, api }) => {
    const seed = (title: string) => api<TaskDetail>("POST", "/tasks", { title });
    const [oldFirst, oldNext, newFirst, newNext] = await Promise.all([
      seed("Original · primeira página"), seed("Original · outra página"),
      seed("Nova · primeira página"), seed("Nova · outra página"),
    ]);
    const { referenceDate } = await api<{ referenceDate: string }>("GET", "/views/today");
    const originalPage = Promise.withResolvers<void>();
    const nextSearch = Promise.withResolvers<void>();
    const queries: [string | undefined, string | undefined][] = [];
    await page.route("**/api/v1/search", async (route) => {
      const { text, cursor } = route.request().postDataJSON() as SearchInput;
      queries.push([text, cursor]);
      const match = text === "Original" ? (cursor ? oldNext : oldFirst) : (cursor ? newNext : newFirst);
      if (text === "Original" && cursor) {
        originalPage.resolve();
        await nextSearch.promise;
      }
      const result: SearchResult = { referenceDate, results: [match], nextCursor: cursor ? null : `${text}-cursor` };
      await route.fulfill({ json: result });
    });

    const result = (task: TaskDetail): Locator => row(page, task.title);
    await page.goto("/busca");
    const input = page.getByRole("searchbox", { name: "Buscar tarefas por título ou descrição" });
    const loadMore = page.getByRole("button", { name: "Carregar mais" });
    await input.fill("Original");
    await expect(result(oldFirst)).toBeVisible();
    await loadMore.click();
    try {
      await originalPage.promise;
      await expect(loadMore).toBeDisabled();
      await input.fill("Nova");
      await expect(result(newFirst)).toBeVisible();
    } finally {
      nextSearch.resolve();
    }

    await loadMore.click();
    await expect(result(newNext)).toBeVisible();
    await expect(result(oldFirst)).toHaveCount(0);
    await expect(result(oldNext)).toHaveCount(0);
    await expect(loadMore).toHaveCount(0);
    expect(queries).toEqual([
      ["Original", undefined], ["Original", "Original-cursor"],
      ["Nova", undefined], ["Nova", "Nova-cursor"],
    ]);
  });
});

import type { Page, Route } from "@playwright/test";
import type { TaskDetail, TaskMutation } from "@/client/types";
import { expect, row, test } from "./fixtures";

async function holdRequest(
  page: Page,
  method: string,
  path: string,
  respond: (route: Route) => Promise<void> = (route) => route.continue(),
) {
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route((url) => url.pathname === `/api/v1${path}`, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    received.resolve();
    await release.promise;
    await respond(route);
  });
  return { received: received.promise, release: () => release.resolve() };
}

function waitForCreatedTask(page: Page) {
  return page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/v1/tasks");
}

test("Enter insere a tarefa na seção e troca o ID após a resposta, sem depender da leitura do projeto", async ({ page, api }) => {
  const { id: projectId } = await api<{ id: string }>("POST", "/projects", { name: "Projeto da criação imediata" });
  const { id: sectionId } = await api<{ id: string }>("POST", `/projects/${projectId}/sections`, { name: "Preparar" });
  await page.goto(`/projetos/${projectId}`);
  const section = page.getByRole("region", { name: "Preparar", exact: true });
  await expect(section.locator(".count")).toHaveText("0");

  const projectRead = await holdRequest(page, "GET", `/projects/${projectId}`);
  const create = await holdRequest(page, "POST", "/tasks");
  const title = "Separar materiais";
  const task = row(page, title);
  await section.getByRole("button", { name: "Adicionar tarefa" }).click();
  const input = page.getByRole("textbox", { name: "Título da tarefa" });
  await input.fill(title);

  try {
    await input.press("Enter");
    await create.received;
    await expect(section.locator(task)).toBeVisible();
    await expect(section.locator(".count")).toHaveText("1");
    const temporaryId = await task.getAttribute("data-task-id");
    expect(temporaryId).toBeTruthy();

    const response = waitForCreatedTask(page);
    create.release();
    const savedResponse = await response;
    expect(savedResponse.status()).toBe(201);
    const { result: saved }: TaskMutation<TaskDetail> = await savedResponse.json();
    expect(saved).toMatchObject({ title, projectId, sectionId, parentId: null });
    expect(saved.id).not.toBe(temporaryId);
    await expect(section.locator(task)).toHaveAttribute("data-task-id", saved.id);
    await expect(task).toHaveCount(1);
  } finally {
    create.release();
    projectRead.release();
  }
});

test("captura rápida aparece em Hoje e uma conclusão rejeitada preserva outra já confirmada", async ({ page, api, isMobile }) => {
  const { referenceDate } = await api<{ referenceDate: string }>("GET", "/views/today");
  const first = await api<TaskDetail>("POST", "/tasks", { title: "Conferir materiais", dueDate: referenceDate });
  await page.goto("/hoje");
  const firstRow = row(page, first.title);
  await expect(firstRow).toBeVisible();
  const todayCount = page.getByRole("region", { name: /^Hoje · / }).locator(".count");
  const initialCount = Number(await todayCount.textContent());
  const create = await holdRequest(page, "POST", "/tasks");
  if (isMobile) await page.getByRole("button", { name: "Adicionar tarefa", exact: true }).click();
  else await page.keyboard.press("q");
  const title = "Buscar ferramentas";
  const secondRow = row(page, title);
  const quickAdd = page.getByRole("dialog", { name: "Adicionar tarefa" });
  const quickTitle = quickAdd.getByRole("textbox", { name: "Título da tarefa" });
  await quickTitle.fill(title);
  let second: TaskDetail;
  try {
    await quickTitle.press("Enter");
    await create.received;
    await expect(secondRow).toBeVisible();
    await expect(todayCount).toHaveText(String(initialCount + 1));
    const response = waitForCreatedTask(page);
    create.release();
    const savedResponse = await response;
    expect(savedResponse.status()).toBe(201);
    const payload: TaskMutation<TaskDetail> = await savedResponse.json();
    second = payload.result;
  } finally {
    create.release();
  }
  expect(second.dueDate).toBe(referenceDate);
  await expect(secondRow).toHaveAttribute("data-task-id", second.id);
  await page.keyboard.press("Escape");

  const conflict = "A tarefa mudou em outra aba.";
  const firstCompletion = await holdRequest(page, "POST", `/tasks/${first.id}/complete`, (route) => route.fulfill({
    status: 409, json: { error: { code: "REVISION_CONFLICT", message: conflict } },
  }));
  const secondCompletion = await holdRequest(page, "POST", `/tasks/${second.id}/complete`);
  const complete = (title: string) => row(page, title).getByRole("button", { name: new RegExp(`^Concluir “${title}”`) }).click();
  try {
    await complete(first.title);
    await firstCompletion.received;
    await expect(firstRow).toBeHidden();
    await expect(secondRow).toBeVisible();

    await complete(second.title);
    await secondCompletion.received;
    await expect(secondRow).toBeHidden();
    secondCompletion.release();
    await expect(page.getByRole("status").getByRole("button", { name: "Desfazer", exact: true })).toBeVisible();

    firstCompletion.release();
    await expect(page.getByRole("status").getByText(/mudou em outra aba/)).toBeVisible();
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeHidden();
    await expect(todayCount).toHaveText(String(initialCount));
    expect(await api("GET", `/tasks/${first.id}`)).toMatchObject({ status: "active" });
    expect(await api("GET", `/tasks/${second.id}`)).toMatchObject({ status: "completed" });
  } finally {
    firstCompletion.release();
    secondCompletion.release();
  }
});

test("reagendamento remove de Hoje e inclui em Em breve com a mesma edição pendente", async ({ page, api }) => {
  const { referenceDate } = await api<{ referenceDate: string }>("GET", "/views/today");
  const task = await api<TaskDetail>("POST", "/tasks", { title: "Separar as ferramentas", dueDate: referenceDate });
  const tomorrow = page.getByRole("region", { name: /^Amanhã · / });
  await page.goto("/em-breve");
  await expect(tomorrow).toBeVisible();
  await page.getByRole("link", { name: /^Hoje/ }).click();

  const taskRow = row(page, task.title);
  await taskRow.getByRole("button", { name: new RegExp(`^${task.title}`) }).click();
  const detail = page.getByRole("dialog", { name: task.title, exact: true });
  const change = await holdRequest(page, "PATCH", `/tasks/${task.id}`);
  const upcomingRead = await holdRequest(page, "GET", "/views/upcoming");
  try {
    await detail.getByRole("button", { name: "Hoje", exact: true }).click();
    await page.getByRole("dialog", { name: "Data", exact: true }).getByRole("button", { name: /Amanhã/ }).click();
    await change.received;
    await expect(detail.getByRole("button", { name: "Amanhã", exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "Fechar (Esc)" }).click();
    await expect(taskRow).toBeHidden();

    await page.getByRole("link", { name: "Em breve", exact: true }).click();
    await expect(tomorrow.locator(taskRow)).toBeVisible();
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/v1/tasks/${task.id}`);
    change.release();
    expect((await saved).ok()).toBe(true);
    await expect(tomorrow.locator(taskRow)).toBeVisible();
  } finally {
    change.release();
    upcomingRead.release();
  }
});

test("conclusão recorrente adianta a data e Desfazer restaura a ocorrência antes da resposta", async ({ page, api }) => {
  const { referenceDate } = await api<{ referenceDate: string }>("GET", "/views/today");
  const series = await api<TaskDetail>("POST", "/tasks", {
    title: "Regar as plantas", dueDate: referenceDate, dueTime: "09:30", recurrence: { frequency: "daily" },
  });
  const task = await api<TaskDetail>("PATCH", `/tasks/${series.id}`, {
    revision: series.revision, dueTime: "06:00",
  });
  const tomorrow = page.getByRole("region", { name: /^Amanhã · / });
  const todayLink = page.getByRole("link", { name: /^Hoje/ });
  await page.goto("/em-breve");
  await expect(tomorrow).toBeVisible();
  await todayLink.click();
  const taskRow = row(page, task.title);
  await expect(taskRow).toContainText("06:00");
  const complete = await holdRequest(page, "POST", `/tasks/${task.id}/complete`);
  const undo = await holdRequest(page, "POST", `/tasks/${task.id}/undo-completion`);
  const undoButton = page.getByRole("status").getByRole("button", { name: "Desfazer", exact: true });

  try {
    await taskRow.getByRole("button", { name: /^Concluir “Regar as plantas”/ }).click();
    await complete.received;
    await expect(taskRow).toBeHidden();
    await page.getByRole("link", { name: "Em breve", exact: true }).click();
    await expect(tomorrow.locator(taskRow)).toContainText("09:30");
    complete.release();
    await expect(undoButton).toBeVisible();
    const advanced = await api<TaskDetail>("GET", `/tasks/${task.id}`);
    expect(advanced.occurrenceId).not.toBe(task.occurrenceId);
    expect(advanced.dueDate).not.toBe(referenceDate);

    await undoButton.click();
    await undo.received;
    await expect(taskRow).toBeHidden();
    await todayLink.click();
    await expect(taskRow).toContainText("06:00");
    const response = page.waitForResponse((result) => result.request().method() === "POST"
      && new URL(result.url()).pathname === `/api/v1/tasks/${task.id}/undo-completion`);
    undo.release();
    expect((await response).ok()).toBe(true);
    expect(await api("GET", `/tasks/${task.id}`)).toMatchObject({
      dueDate: referenceDate, dueTime: "06:00", occurrenceId: task.occurrenceId,
    });
    await expect(taskRow).toContainText("06:00");
  } finally {
    complete.release();
    undo.release();
  }
});

test("mostra a subtarefa nova no detalhe da tarefa-pai e a retira quando a rede falha", async ({ page, api }) => {
  const parent = await api<TaskDetail>("POST", "/tasks", { title: "Montar a estante" });
  await page.goto("/entrada");
  await row(page, parent.title).getByRole("button", { name: parent.title, exact: true }).click();
  const detail = page.getByRole("dialog", { name: parent.title, exact: true });
  await detail.getByRole("button", { name: "Adicionar subtarefa" }).click();
  const quickAdd = page.getByRole("dialog", { name: "Adicionar tarefa" });
  const title = "Medir os suportes";
  const input = quickAdd.getByRole("textbox", { name: "Título da tarefa" });
  const create = await holdRequest(page, "POST", "/tasks", (route) => route.abort("failed"));
  await input.fill(title);
  const child = detail.getByText(title, { exact: true });
  try {
    await input.press("Enter");
    await create.received;
    await expect(child).toBeVisible();
    create.release();
    await expect(page.getByRole("status").getByText(/Sem conexão com o servidor/)).toBeVisible();
    await expect(child).toHaveCount(0);
    expect(await api("GET", `/tasks/${parent.id}`)).toMatchObject({ childIds: [] });
  } finally {
    create.release();
  }
});

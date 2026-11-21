import type { Page, Route } from "@playwright/test";
import type { TaskDetail } from "@feito/core/types";
import { expect, row, test } from "./fixtures";

// Os testes de abertura offline cobrem o service worker. Aqui controlamos o transporte da fila.
test.use({ serviceWorkers: "block" });

const syncPath = "/api/v1/desktop-sync";
const savedId = /^[a-f0-9-]{36}$/;

type Push = { method: string; path: string; body?: { id?: string; title?: string } };

function syncPush(route: Route): Push | undefined {
  if (route.request().method() === "POST") return route.request().postDataJSON() as Push;
}

async function holdPush(page: Page, method: string, path: string) {
  const received = Promise.withResolvers<Push>();
  const release = Promise.withResolvers<void>();
  await page.route((url) => url.pathname === syncPath, async (route) => {
    const push = syncPush(route);
    if (!push || push.method !== method || push.path !== path) return route.fallback();
    received.resolve(push);
    await release.promise;
    await route.continue();
  });
  return { received: received.promise, release: () => release.resolve() };
}

type WriteGate = { arrived: boolean; release: () => void };
type TestWindow = Window & { feitoWriteGate?: WriteGate };

async function holdWrite(page: Page, method: string, path: string, fail = false) {
  await page.evaluate(({ method, path, fail }) => {
    const put = IDBObjectStore.prototype.put;
    let released = false;
    const gate: WriteGate = {
      arrived: false,
      release() {
        released = true;
        IDBObjectStore.prototype.put = put;
      },
    };
    (window as TestWindow).feitoWriteGate = gate;
    IDBObjectStore.prototype.put = function (value: { pending?: Push[] }, key?: IDBValidKey) {
      const request = put.call(this, value, key);
      const operation = value.pending?.at(-1);
      if (operation?.method !== method || operation.path !== path || gate.arrived || key === undefined) return request;
      gate.arrived = true;
      // O IndexedDB pode concluir a transação ao voltar ao event loop. Mantenha uma leitura
      // real pendente até o teste liberar a confirmação ou o abort da gravação.
      const waitForRelease = () => {
        if (released) {
          if (fail) this.transaction.abort();
        } else {
          this.count().addEventListener("success", waitForRelease, { once: true });
        }
      };
      waitForRelease();
      return request;
    };
  }, { method, path, fail });
  return {
    received: () => expect.poll(() => page.evaluate(() => (window as TestWindow).feitoWriteGate?.arrived)).toBe(true),
    release: () => page.evaluate(() => (window as TestWindow).feitoWriteGate?.release()),
  };
}

test("Enter insere a tarefa na seção e mantém seu ID local ao sincronizar", async ({ page, api }) => {
  const { id: projectId } = await api<{ id: string }>("POST", "/projects", { name: "Projeto da criação imediata" });
  const { id: sectionId } = await api<{ id: string }>("POST", `/projects/${projectId}/sections`, { name: "Preparar" });
  await page.goto(`/projetos/${projectId}`);
  const section = page.getByRole("region", { name: "Preparar", exact: true });
  await expect(section.locator(".count")).toHaveText("0");

  const push = await holdPush(page, "POST", "/tasks");
  const write = await holdWrite(page, "POST", "/tasks");
  const title = "Separar materiais";
  const task = row(page, title);
  await section.getByRole("button", { name: "Adicionar tarefa" }).click();
  const input = page.getByRole("textbox", { name: "Título da tarefa" });
  await input.fill(title);

  try {
    await input.press("Enter");
    await write.received();
    await expect(input).toHaveValue("");
    await expect(section.locator(task)).toBeVisible();
    await expect(section.locator(".count")).toHaveText("1");
    await expect(task).toHaveAttribute("data-task-id", /^pending:/);

    await write.release();
    await expect(task).toHaveAttribute("data-task-id", savedId);
    const id = (await task.getAttribute("data-task-id"))!;
    const operation = await push.received;
    expect(operation.body).toMatchObject({ id, title, projectId, sectionId });
    expect((await page.request.get(`/api/v1/tasks/${id}`)).status()).toBe(404);
    push.release();
    await expect.poll(async () => (await page.request.get(`/api/v1/tasks/${id}`)).status()).toBe(200);
    expect(await api("GET", `/tasks/${id}`)).toMatchObject({ id, title, projectId, sectionId, parentId: null });
    await expect(task).toHaveCount(1);
  } finally {
    await write.release();
    push.release();
  }
});

test("limpa o campo ao enviar e devolve o texto quando a gravação local falha", async ({ page, api }) => {
  const { id: projectId } = await api<{ id: string }>("POST", "/projects", { name: "Projeto da criação recuperada" });
  await page.goto(`/projetos/${projectId}`);
  await page.getByRole("button", { name: "Adicionar tarefa", exact: true }).first().click();
  const write = await holdWrite(page, "POST", "/tasks", true);
  const input = page.getByRole("textbox", { name: "Título da tarefa" });
  const description = page.getByRole("textbox", { name: "Descrição" });
  await input.fill("Revisar orçamento");
  await description.fill("Conferir as três cotações");

  try {
    await input.press("Enter");
    await write.received();
    await expect(input).toHaveValue("");
    await expect(description).toHaveValue("");
    await expect(row(page, "Revisar orçamento")).toBeVisible();
    await write.release();
    await expect(row(page, "Revisar orçamento")).toBeHidden();
    await expect(input).toHaveValue("Revisar orçamento");
    await expect(description).toHaveValue("Conferir as três cotações");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Projeto da criação recuperada" })).toBeVisible();
    await expect(row(page, "Revisar orçamento")).toHaveCount(0);
  } finally {
    await write.release();
  }
});

test("mostra o texto da criação que falhou quando o campo já tem texto novo", async ({ page, api }) => {
  const { id: projectId } = await api<{ id: string }>("POST", "/projects", { name: "Projeto da criação listada" });
  await page.goto(`/projetos/${projectId}`);
  await page.getByRole("button", { name: "Adicionar tarefa", exact: true }).first().click();
  const write = await holdWrite(page, "POST", "/tasks", true);
  const input = page.getByRole("textbox", { name: "Título da tarefa" });
  await input.fill("Ligar para o fornecedor");
  await page.getByRole("textbox", { name: "Descrição" }).fill("Pedir o prazo de entrega");

  try {
    await input.press("Enter");
    await write.received();
    await expect(input).toHaveValue("");
    await input.fill("Outra ideia");
    await write.release();
    const recovery = page.getByRole("dialog", { name: "Tarefa não adicionada" });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByText("Ligar para o fornecedor")).toBeVisible();
    await expect(recovery.getByText("Pedir o prazo de entrega")).toBeVisible();
    await expect(input).toHaveValue("Outra ideia");
    await recovery.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(recovery).toBeHidden();
  } finally {
    await write.release();
  }
});

test("captura rápida aparece em Hoje e o rollback de uma conclusão preserva a outra", async ({ page, api, isMobile }) => {
  const { referenceDate } = await api<{ referenceDate: string }>("GET", "/views/today");
  const first = await api<TaskDetail>("POST", "/tasks", { title: "Conferir materiais", dueDate: referenceDate });
  await page.goto("/hoje");
  const firstRow = row(page, first.title);
  await expect(firstRow).toBeVisible();
  const todayCount = page.getByRole("region", { name: /^Hoje · / }).locator(".count");
  const initialCount = Number(await todayCount.textContent());
  if (isMobile) await page.getByRole("button", { name: "Adicionar tarefa", exact: true }).click();
  else await page.keyboard.press("q");
  const title = "Buscar ferramentas";
  const secondRow = row(page, title);
  const quickAdd = page.getByRole("dialog", { name: "Adicionar tarefa" });
  const quickTitle = quickAdd.getByRole("textbox", { name: "Título da tarefa" });
  await quickTitle.fill(title);
  await quickTitle.press("Enter");
  await expect(secondRow).toHaveAttribute("data-task-id", savedId);
  await expect(todayCount).toHaveText(String(initialCount + 1));
  const secondId = (await secondRow.getAttribute("data-task-id"))!;
  await expect.poll(async () => (await page.request.get(`/api/v1/tasks/${secondId}`)).status()).toBe(200);
  expect(await api("GET", `/tasks/${secondId}`)).toMatchObject({ dueDate: referenceDate });
  await page.keyboard.press("Escape");

  const write = await holdWrite(page, "POST", `/tasks/${first.id}/complete`, true);
  const complete = (label: string) => row(page, label).getByRole("button", { name: new RegExp(`^Concluir “${label}”`) }).click();
  try {
    await complete(first.title);
    await write.received();
    await expect(firstRow).toBeHidden();
    await expect(secondRow).toBeVisible();

    await complete(title);
    await expect(secondRow).toBeHidden();
    await write.release();
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeHidden();
    await expect(todayCount).toHaveText(String(initialCount));
    expect(await api("GET", `/tasks/${first.id}`)).toMatchObject({ status: "active" });
    await expect.poll(() => api<TaskDetail>("GET", `/tasks/${secondId}`).then(({ status }) => status)).toBe("completed");
  } finally {
    await write.release();
  }
});

test("reagendamento remove de Hoje e inclui em Em breve antes da sincronização", async ({ page, api }) => {
  const { referenceDate } = await api<{ referenceDate: string }>("GET", "/views/today");
  const task = await api<TaskDetail>("POST", "/tasks", { title: "Separar as ferramentas", dueDate: referenceDate });
  const tomorrow = page.getByRole("region", { name: /^Amanhã · / });
  await page.goto("/em-breve");
  await expect(tomorrow).toBeVisible();
  await page.getByRole("link", { name: /^Hoje/ }).click();

  const taskRow = row(page, task.title);
  await taskRow.getByRole("button", { name: new RegExp(`^${task.title}`) }).click();
  const detail = page.getByRole("dialog", { name: task.title, exact: true });
  const push = await holdPush(page, "PATCH", `/tasks/${task.id}`);
  try {
    await detail.getByRole("button", { name: "Hoje", exact: true }).click();
    await page.getByRole("dialog", { name: "Data", exact: true }).getByRole("button", { name: /Amanhã/ }).click();
    await push.received;
    await expect(detail.getByRole("button", { name: "Amanhã", exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "Fechar (Esc)" }).click();
    await expect(taskRow).toBeHidden();

    await page.getByRole("link", { name: "Em breve", exact: true }).click();
    await expect(tomorrow.locator(taskRow)).toBeVisible();
    expect(await api("GET", `/tasks/${task.id}`)).toMatchObject({ dueDate: referenceDate });
    push.release();
    await expect.poll(() => api<TaskDetail>("GET", `/tasks/${task.id}`).then(({ dueDate }) => dueDate)).not.toBe(referenceDate);
    await expect(tomorrow.locator(taskRow)).toBeVisible();
  } finally {
    push.release();
  }
});

test("conclusão recorrente adianta a data e Desfazer restaura a ocorrência antes da sincronização", async ({ page, api }) => {
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
  const complete = await holdPush(page, "POST", `/tasks/${task.id}/complete`);
  const undo = await holdPush(page, "POST", `/tasks/${task.id}/undo-completion`);
  const undoButton = page.getByRole("status").getByRole("button", { name: "Desfazer", exact: true });

  try {
    await taskRow.getByRole("button", { name: /^Concluir “Regar as plantas”/ }).click();
    await complete.received;
    await expect(taskRow).toBeHidden();
    await page.getByRole("link", { name: "Em breve", exact: true }).click();
    await expect(tomorrow.locator(taskRow)).toContainText("09:30");
    expect(await api("GET", `/tasks/${task.id}`)).toMatchObject({ occurrenceId: task.occurrenceId });

    await undoButton.click();
    await expect(taskRow).toBeHidden();
    await todayLink.click();
    await expect(taskRow).toContainText("06:00");
    complete.release();
    await undo.received;
    const advanced = await api<TaskDetail>("GET", `/tasks/${task.id}`);
    expect(advanced.occurrenceId).not.toBe(task.occurrenceId);
    expect(advanced.dueDate).not.toBe(referenceDate);
    undo.release();
    await expect.poll(() => api("GET", `/tasks/${task.id}`)).toMatchObject({
      dueDate: referenceDate, dueTime: "06:00", occurrenceId: task.occurrenceId,
    });
    await expect(taskRow).toContainText("06:00");
  } finally {
    complete.release();
    undo.release();
  }
});

test("a subtarefa da fila continua visível após falha de rede e reabertura", async ({ page, context, api }) => {
  const parent = await api<TaskDetail>("POST", "/tasks", { title: "Montar a estante" });
  await page.goto("/entrada");
  const parentButton = row(page, parent.title).getByRole("button", { name: /^Montar a estante(?: |$)/ });
  await parentButton.click();
  const detail = page.getByRole("dialog", { name: parent.title, exact: true });
  await detail.getByRole("button", { name: "Adicionar subtarefa" }).click();
  const quickAdd = page.getByRole("dialog", { name: "Adicionar tarefa" });
  const title = "Medir os suportes";
  const input = quickAdd.getByRole("textbox", { name: "Título da tarefa" });
  let attempts = 0;
  const matchSync = (url: URL) => url.pathname === syncPath;
  const abort = (route: Route) => {
    if (syncPush(route)?.body?.title !== title) return route.fallback();
    attempts++;
    return route.abort("failed");
  };
  await page.route(matchSync, abort);
  await input.fill(title);
  await input.press("Enter");
  await expect.poll(() => attempts).toBeGreaterThan(0);
  const child = detail.getByText(title, { exact: true });
  await expect(child).toBeVisible();
  expect(await api("GET", `/tasks/${parent.id}`)).toMatchObject({ childIds: [] });

  await page.reload();
  await parentButton.click();
  await expect(child).toBeVisible();
  await expect(page.getByRole("link", { name: /^Sincronização interrompida.*1 alteração pendente/ })).toBeVisible();
  await page.unroute(matchSync, abort);
  await context.setOffline(true);
  await expect(page.getByRole("link", { name: /^Sem conexão.*1 alteração pendente/ })).toBeVisible();
  await context.setOffline(false);
  await expect.poll(() => api<TaskDetail>("GET", `/tasks/${parent.id}`).then(({ childIds }) => childIds.length)).toBe(1);
  await expect(child).toBeVisible();
});

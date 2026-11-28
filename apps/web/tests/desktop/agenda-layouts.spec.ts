import { expect, type Page } from "@playwright/test";
import type { Layout } from "@feito/core/types";
import { handleLocal, type Workspace } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

/** Data civil no fuso padrão do espaço, deslocada em dias. */
function civil(offset: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function openAgenda(page: Page, path: string, preferences: { todayLayout?: Layout; todayTimeline?: boolean } = {}) {
  let workspace = newPortugueseWorkspace();
  Object.assign(workspace.preferences, preferences);
  const write = async (route: string, body: object) => {
    const result = await handleLocal(workspace, { method: "POST", path: route, body });
    expect(result.status).toBeLessThan(400);
    workspace = result.workspace;
    return result.body as { id: string };
  };
  const project = await write("/projects", { name: "Casa" });
  await write("/tasks", { title: "Pagar a conta de luz", projectId: project.id, dueDate: civil(-2) });
  await write("/tasks", { title: "Regar as plantas", dueDate: civil(0) });
  await write("/tasks", { title: "Reunião de obra", projectId: project.id, dueDate: civil(0), dueTime: "09:00" });
  await write("/tasks", { title: "Comprar tinta", projectId: project.id, dueDate: civil(1) });
  await write("/tasks", { title: "Pintar a sala", projectId: project.id, dueDate: civil(3), dueTime: "14:00" });
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  await page.goto(path);
}

async function savedWorkspace(page: Page) {
  return page.evaluate(async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<{
      value: { local: Workspace };
    }> } }).__TAURI_INTERNALS__;
    return (await internals.invoke("read_workspace")).value.local;
  });
}

async function savedPreferences(page: Page) {
  return (await savedWorkspace(page)).preferences;
}

async function pickLayout(page: Page, current: string, next: string) {
  await page.getByRole("button", { name: `Mostrar: ${current}` }).click();
  await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: next }).click();
  await page.keyboard.press("Escape");
}

test("Hoje abre na Agenda, troca entre os layouts e guarda a escolha na conta", async ({ page }) => {
  await openAgenda(page, "/#/hoje");
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  await expect(page.locator(".tb .tb-tools-wide .tool-btn .tool-label")).toHaveText("Mostrar");
  // Sem escolha salva, Hoje abre na Agenda: com horário na régua, atrasadas e sem horário ao lado.
  await expect(page.getByRole("region", { name: "Com horário" })).toContainText("Reunião de obra");
  await expect(page.getByRole("region", { name: "Atrasadas" })).toContainText("Pagar a conta de luz");
  await expect(page.getByRole("region", { name: "Sem horário" })).toContainText("Regar as plantas");
  await page.screenshot({ path: test.info().outputPath("hoje-linha-do-dia.png") });

  await pickLayout(page, "Agenda", "Painel");
  const columns = page.locator(".agenda-board .column");
  await expect(columns).toHaveCount(2);
  await expect(columns.nth(0).locator(".col-h")).toContainText("Atrasadas");
  await expect(columns.nth(0)).toContainText("Pagar a conta de luz");
  await expect(columns.nth(1)).toContainText("Reunião de obra");
  await expect.poll(() => savedPreferences(page)).toMatchObject({ todayLayout: "board", todayTimeline: false });
  await page.screenshot({ path: test.info().outputPath("hoje-painel.png") });

  // Hoje não tem Calendário: a Agenda já mostra o dia por horário.
  await page.getByRole("button", { name: "Mostrar: Painel" }).click();
  await expect(page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio")).toHaveText(["Agenda", "Lista", "Painel", "Tabela"]);
  await page.keyboard.press("Escape");

  await pickLayout(page, "Painel", "Tabela");
  await expect(page.getByRole("table", { name: "Tarefas" }).getByRole("rowgroup", { name: "Atrasadas" })).toContainText("Pagar a conta de luz");
  await page.screenshot({ path: test.info().outputPath("hoje-tabela.png") });

  await pickLayout(page, "Tabela", "Lista");
  await expect(page.locator(".agenda-board, .pcal, .ptable")).toHaveCount(0);
  await expect(page.getByText("Regar as plantas")).toBeVisible();
  await expect.poll(() => savedPreferences(page)).toMatchObject({ todayLayout: "list" });

  await pickLayout(page, "Lista", "Agenda");
  await expect(page.getByRole("region", { name: "Com horário" })).toContainText("Reunião de obra");
  await expect.poll(() => savedPreferences(page)).toMatchObject({ todayLayout: "list", todayTimeline: true });
});

test("Agenda permite mover uma tarefa com horário em passos de 15 minutos", async ({ page }) => {
  const date = civil(0);
  await page.clock.setFixedTime(new Date(`${date}T15:00:00Z`));
  await openAgenda(page, "/#/hoje");
  const title = "Reunião de obra";
  const agenda = page.getByRole("region", { name: "Com horário" });
  const block = agenda.locator(".tl-block").filter({ hasText: title });
  const task = block.getByRole("button", { name: title, exact: true });
  const time = block.locator(".tl-time");
  const preview = agenda.locator(".tl-drop .tl-time");
  const details = page.getByRole("dialog", { name: title, exact: true });
  const savedSchedule = async () => (await savedWorkspace(page)).tasks.find(({ data }) => data.title === title)?.data;

  const startDrag = async () => {
    await task.scrollIntoViewIfNeeded();
    const box = (await task.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    return point;
  };

  for (const [distance, expectedTime] of [[12, "09:15"], [-24, "08:45"]] as const) {
    const point = await startDrag();
    await page.mouse.move(point.x, point.y + distance, { steps: 4 });
    await expect(preview).toHaveText(expectedTime);
    await page.mouse.up();
    await expect(preview).toHaveCount(0);
    await expect(time).toHaveText(expectedTime);
    await expect(details).toBeHidden();
    await expect.poll(savedSchedule).toMatchObject({ dueDate: date, dueTime: expectedTime });
  }

  const point = await startDrag();
  await page.mouse.move(point.x + 12, point.y, { steps: 4 });
  await expect(preview).toHaveText("08:45");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await page.mouse.up();
  await expect(details).toBeHidden();
  await expect(time).toHaveText("08:45");
  expect(await savedSchedule()).toMatchObject({ dueDate: date, dueTime: "08:45" });

  await task.focus();
  await page.keyboard.press("Enter");
  await expect(details).toBeVisible();
});

test("Agenda permite arrastar uma tarefa de Sem horário para a grade e de volta", async ({ page }) => {
  const date = civil(0);
  await page.clock.setFixedTime(new Date(`${date}T15:00:00Z`));
  await openAgenda(page, "/#/hoje");
  const agenda = page.getByRole("region", { name: "Com horário" });
  const untimed = page.getByRole("region", { name: "Sem horário" });
  const title = "Regar as plantas";
  const grid = (await agenda.locator(".tl-grid").boundingBox())!;
  const hour = (await agenda.getByText("10:00", { exact: true }).boundingBox())!;
  const source = (await untimed.getByText(title).boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(grid.x + grid.width / 2, hour.y + hour.height / 2, { steps: 8 });
  await expect(agenda.locator(".tl-drop")).toHaveCSS("transition-property", "none");
  await page.mouse.up();
  const scheduled = agenda.locator(".tl-block").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  await expect(scheduled.locator(".tl-time")).toHaveText("10:00");
  await expect(untimed.getByText(title)).toHaveCount(0);
  await expect(untimed.getByText("Nada sem horário hoje.")).toBeVisible();

  const task = (await scheduled.getByRole("button", { name: title, exact: true }).boundingBox())!;
  const zone = (await untimed.boundingBox())!;
  await page.mouse.move(task.x + task.width / 2, task.y + task.height / 2);
  await page.mouse.down();
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 8 });
  await expect(untimed.locator("..")).toHaveClass(/\bdrag-over\b/);
  await page.mouse.up();
  await expect(scheduled).toHaveCount(0);
  await expect(untimed.getByText(title)).toBeVisible();
  await expect.poll(async () =>
    (await savedWorkspace(page)).tasks.find(({ data }) => data.title === title)?.data
  ).toMatchObject({ dueDate: date, dueTime: null });
});

test("A prévia desliza entre horários enquanto a tarefa é arrastada", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
  await page.clock.setFixedTime(new Date(`${civil(0)}T15:00:00Z`));
  await openAgenda(page, "/#/hoje");
  const agenda = page.getByRole("region", { name: "Com horário" });
  const task = agenda.getByRole("button", { name: "Reunião de obra", exact: true });
  const box = (await task.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 12);
  const preview = agenda.locator(".tl-drop");
  await expect(preview.locator(".tl-time")).toHaveText("09:15");
  await preview.evaluate((element) => {
    element.addEventListener("transitionrun", (event) => {
      if (event instanceof TransitionEvent && event.propertyName === "transform") element.setAttribute("data-sliding", "true");
    });
  });
  await page.mouse.move(x, y + 24);
  await expect(preview.locator(".tl-time")).toHaveText("09:30");
  await expect(preview).toHaveAttribute("data-sliding", "true");
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
});

test("Em breve mostra um dia por coluna no Painel e a semana no Calendário", async ({ page }) => {
  await openAgenda(page, "/#/em-breve");
  await pickLayout(page, "Lista", "Painel");
  const columns = page.locator(".agenda-board .column");
  await expect(columns).toHaveCount(7);
  await expect(columns.nth(0)).toContainText("Comprar tinta");
  await expect(columns.nth(2)).toContainText("Pintar a sala");
  await page.screenshot({ path: test.info().outputPath("em-breve-painel.png") });

  await pickLayout(page, "Painel", "Calendário");
  await expect(page.locator(".pcal-week[data-days='7']")).toBeVisible();
  await expect(page.locator(".pcal-hours .pcal-chip")).toContainText("Pintar a sala");
  await page.screenshot({ path: test.info().outputPath("em-breve-calendario.png") });
  await expect.poll(() => savedPreferences(page)).toMatchObject({ upcomingLayout: "calendar" });
});

test.describe("rótulos dos botões da barra de título", () => {
  test.use({ viewport: { width: 1000, height: 800 } });

  test("ficam só com o ícone quando a janela é estreita", async ({ page }) => {
    await openAgenda(page, "/#/hoje");
    const show = page.locator(".tb .tb-tools-wide .tool-btn");
    await expect(show).toBeVisible();
    await expect(show.locator(".tool-label")).toBeHidden();
  });
});

test.describe("agendas no celular", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("abre pelo toque a tarefa com horário na lista da Agenda", async ({ page }) => {
    await openAgenda(page, "/#/hoje");
    const agenda = page.getByRole("region", { name: "Com horário" });
    const title = "Reunião de obra";
    await agenda.getByRole("button", { name: title, exact: true }).tap();
    await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible();
  });

  test("Em breve troca para Painel e Calendário pela folha Mostrar", async ({ page }) => {
    await openAgenda(page, "/#/em-breve");
    await page.getByRole("button", { name: "Mostrar: Lista" }).click();
    const sheet = page.getByRole("dialog", { name: "Visualização" });
    await sheet.getByRole("radio", { name: "Painel" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".agenda-board .column").first()).toContainText("Comprar tinta");
    await page.screenshot({ path: test.info().outputPath("celular-painel.png") });

    await page.getByRole("button", { name: "Mostrar: Painel" }).click();
    await sheet.getByRole("radio", { name: "Calendário" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pcal-mgrid .pcal-mday")).toHaveCount(7);
    await expect(page.locator(".pcal-agenda")).toContainText("Comprar tinta");
    await page.screenshot({ path: test.info().outputPath("celular-calendario.png") });
  });

  test("uma visão salva em Tabela vira Lista, sem a opção no menu nem mudar o que está salvo", async ({ page }) => {
    await openAgenda(page, "/#/hoje", { todayLayout: "table", todayTimeline: false });
    await expect(page.getByText("Regar as plantas")).toBeVisible();
    await expect(page.locator(".ptable")).toHaveCount(0);

    await page.getByRole("button", { name: "Mostrar: Lista" }).click();
    const sheet = page.getByRole("dialog", { name: "Visualização" });
    await expect(sheet.getByRole("radio")).toHaveText(["Agenda", "Lista", "Painel"]);
    await expect(sheet.getByRole("radio", { name: "Lista" })).toBeChecked();
    await sheet.getByRole("radio", { name: "Lista" }).click();
    await page.screenshot({ path: test.info().outputPath("celular-tabela-salva.png") });
    await page.keyboard.press("Escape");
    expect(await savedPreferences(page)).toMatchObject({ todayLayout: "table" });

    // Em uma tela larga a escolha salva volta a valer.
    await page.setViewportSize({ width: 1180, height: 800 });
    await expect(page.getByRole("table", { name: "Tarefas" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mostrar: Tabela" })).toBeVisible();
  });
});

test.describe("agendas no tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test("Hoje e Em breve mostram a Tabela", async ({ page }) => {
    await openAgenda(page, "/#/hoje", { todayLayout: "table", todayTimeline: false });
    await expect(page.getByRole("table", { name: "Tarefas" })).toContainText("Regar as plantas");
    await page.goto("/#/em-breve");
    await page.getByRole("button", { name: "Mostrar: Lista" }).click();
    await page.getByRole("dialog", { name: "Visualização" }).getByRole("radio", { name: "Tabela" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("table", { name: "Tarefas" })).toContainText("Comprar tinta");
  });
});


import { expect, type Page } from "@playwright/test";
import type { Layout } from "@feito/core/types";
import { handleLocal } from "../../../desktop/src/data/local";
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

async function savedPreferences(page: Page) {
  return page.evaluate(async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<{
      value: { local: { preferences: Record<string, unknown> } };
    }> } }).__TAURI_INTERNALS__;
    return (await internals.invoke("read_workspace")).value.local.preferences;
  });
}

async function pickLayout(page: Page, current: string, next: string) {
  await page.getByRole("button", { name: `Mostrar: ${current}` }).click();
  await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: next }).click();
  await page.keyboard.press("Escape");
}

test("Hoje abre na Linha do dia, troca entre os layouts e guarda a escolha na conta", async ({ page }) => {
  await openAgenda(page, "/#/hoje");
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  await expect(page.locator(".tb .tb-tools-wide .tool-btn .tool-label")).toHaveText("Mostrar");
  // Sem escolha salva, Hoje abre na Linha do dia: com horário na régua, atrasadas e sem horário ao lado.
  await expect(page.getByRole("region", { name: "Com horário" })).toContainText("Reunião de obra");
  await expect(page.getByRole("region", { name: "Atrasadas" })).toContainText("Pagar a conta de luz");
  await expect(page.getByRole("region", { name: "Sem horário" })).toContainText("Regar as plantas");
  await page.screenshot({ path: test.info().outputPath("hoje-linha-do-dia.png") });

  await pickLayout(page, "Linha do dia", "Painel");
  const columns = page.locator(".agenda-board .column");
  await expect(columns).toHaveCount(2);
  await expect(columns.nth(0).locator(".col-h")).toContainText("Atrasadas");
  await expect(columns.nth(0)).toContainText("Pagar a conta de luz");
  await expect(columns.nth(1)).toContainText("Reunião de obra");
  await expect.poll(() => savedPreferences(page)).toMatchObject({ todayLayout: "board", todayTimeline: false });
  await page.screenshot({ path: test.info().outputPath("hoje-painel.png") });

  await pickLayout(page, "Painel", "Calendário");
  await expect(page.locator(".pcal-week[data-days='1']")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Atrasadas" })).toContainText("Pagar a conta de luz");
  await expect(page.locator(".pcal-hours .pcal-chip")).toContainText("Reunião de obra");
  await page.screenshot({ path: test.info().outputPath("hoje-calendario.png") });

  await pickLayout(page, "Calendário", "Tabela");
  await expect(page.getByRole("table", { name: "Tarefas" }).getByRole("rowgroup", { name: "Atrasadas" })).toContainText("Pagar a conta de luz");
  await page.screenshot({ path: test.info().outputPath("hoje-tabela.png") });

  await pickLayout(page, "Tabela", "Lista");
  await expect(page.locator(".agenda-board, .pcal, .ptable")).toHaveCount(0);
  await expect(page.getByText("Regar as plantas")).toBeVisible();
  await expect.poll(() => savedPreferences(page)).toMatchObject({ todayLayout: "list" });

  await pickLayout(page, "Lista", "Linha do dia");
  await expect(page.getByRole("region", { name: "Com horário" })).toContainText("Reunião de obra");
  await expect.poll(() => savedPreferences(page)).toMatchObject({ todayLayout: "list", todayTimeline: true });
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
    await expect(sheet.getByRole("radio")).toHaveText(["Linha do dia", "Lista", "Painel", "Calendário"]);
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


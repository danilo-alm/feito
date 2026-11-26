import { expect, type Locator, type Page } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

async function openApp(page: Page, path = "/#/hoje") {
  let workspace = newPortugueseWorkspace();
  for (const [route, name] of [["/projects", "Casa"], ["/projects", "Trabalho"], ["/projects", "Viagem"],
    ["/labels", "agora"], ["/labels", "depois"]]) {
    const result = await handleLocal(workspace, { method: "POST", path: route, body: { name } });
    expect(result.status).toBe(201);
    workspace = result.workspace;
  }
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  await page.goto(path);
}

const sidebarNames = (page: Page, selector: string) =>
  page.locator(`nav.side ${selector} .proj-link`).allTextContents();
const sidebarProjects = (page: Page) => page.locator("nav.side .proj-row").filter({ has: page.locator('a[href*="projetos"]') });
const sidebarLabels = (page: Page) => page.locator("nav.side .proj-row").filter({ has: page.locator('a[href*="etiquetas"]') });

/** Nomes guardados pela ponte nativa simulada, na ordem da navegação do espaço salvo. */
async function savedOrder(page: Page) {
  return page.evaluate(async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<{
      value: { local: { projects: { isInbox: boolean; data: { name: string; position?: number } }[];
        labels: { data: { name: string; position?: number } }[] } };
    }> } }).__TAURI_INTERNALS__;
    const { value } = await internals.invoke("read_workspace");
    const byPosition = <T extends { data: { name: string; position?: number } }>(items: T[]) =>
      items.filter((item) => item.data.position !== undefined)
        .sort((a, b) => a.data.position! - b.data.position!).map((item) => item.data.name);
    return { projects: byPosition(value.local.projects.filter((project) => !project.isInbox)), labels: byPosition(value.local.labels) };
  });
}

async function dragWithMouse(page: Page, source: Locator, target: Locator, offset: number) {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, to.y + to.height / 2 + offset, { steps: 12 });
  await expect(page.locator(".drag-overlay")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".drag-overlay")).toHaveCount(0);
}

test("reordena projetos e etiquetas da barra lateral com o mouse, o teclado e o menu", async ({ page }) => {
  await openApp(page);
  await expect(sidebarProjects(page)).toHaveCount(3);
  expect(await sidebarNames(page, ".proj-row")).toEqual(["Casa", "Trabalho", "Viagem", "agora", "depois"]);

  await dragWithMouse(page, sidebarProjects(page).filter({ hasText: "Viagem" }), sidebarProjects(page).filter({ hasText: "Casa" }), -8);
  await expect(page).toHaveURL(/#\/hoje$/);
  await expect(sidebarProjects(page)).toHaveText(["Viagem", "Casa", "Trabalho"]);
  await expect.poll(() => savedOrder(page)).toMatchObject({ projects: ["Viagem", "Casa", "Trabalho"] });

  const casa = sidebarProjects(page).filter({ hasText: "Casa" }).getByRole("link");
  await casa.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(sidebarProjects(page)).toHaveText(["Viagem", "Trabalho", "Casa"]);
  await expect(casa).toBeFocused();
  await expect(page).toHaveURL(/#\/hoje$/);

  await sidebarLabels(page).filter({ hasText: "depois" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mover para cima" }).click();
  await expect(sidebarLabels(page)).toHaveText(["depois", "agora"]);
  await expect.poll(() => savedOrder(page)).toEqual({ projects: ["Viagem", "Trabalho", "Casa"], labels: ["depois", "agora"] });

  await page.keyboard.press("Control+1");
  await expect(page.getByRole("heading", { name: "Viagem", level: 1 })).toBeVisible();
});

test.describe("aba Navegar no celular", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("segura e arrasta um projeto para outra posição sem abrir o link", async ({ page }) => {
    await openApp(page, "/#/navegar");
    const rows = page.locator(".browse li[data-reorder-item]");
    const projects = rows.filter({ has: page.locator('a[href*="projetos"]') });
    await expect(projects).toHaveText(["Casa", "Trabalho", "Viagem"]);

    const from = (await projects.filter({ hasText: "Trabalho" }).boundingBox())!;
    const to = (await projects.filter({ hasText: "Casa" }).boundingBox())!;
    const x = from.x + 80;
    const client = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) => client.send("Input.dispatchTouchEvent", {
      type, touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
    await touch("touchStart", from.y + from.height / 2);
    await page.waitForTimeout(550);
    await expect(page.locator(".drag-overlay")).toBeVisible();
    for (let step = 1; step <= 10; step++) {
      await touch("touchMove", from.y + from.height / 2 + (to.y + 6 - from.y - from.height / 2) * step / 10);
    }
    await touch("touchEnd", to.y + 6);

    await expect(projects).toHaveText(["Trabalho", "Casa", "Viagem"]);
    await expect(page).toHaveURL(/#\/navegar$/);
    await expect.poll(() => savedOrder(page)).toMatchObject({ projects: ["Trabalho", "Casa", "Viagem"] });
  });
});

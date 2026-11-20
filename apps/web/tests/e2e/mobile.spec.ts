import type { Page } from "@playwright/test";
import { expect, projectState, row, seedProject, test } from "./fixtures";

/** Toque prolongado e arraste com eventos de toque reais (CDP). */
async function longPressDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = 550) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
  await page.waitForTimeout(hold);
  const steps = 14;
  for (let index = 1; index <= steps; index++) {
    const x = from.x + ((to.x - from.x) * index) / steps;
    const y = from.y + ((to.y - from.y) * index) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, y) });
    await page.waitForTimeout(16);
  }
  return async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  };
}

test.describe("celular", () => {
  test.skip(({ isMobile }) => !isMobile, "Somente no perfil de celular");

  test("pressionar e segurar arrasta; deslizar rápido só rola", async ({ page, api }) => {
    const seed = await seedProject(api, `Toque ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    const before = (await projectState(api, seed.id)).order(seed.sections.Planejar);

    // Movimento antes do tempo de ativação não arrasta.
    const quick = await row(page, "Listar móveis para doação").boundingBox();
    const release = await longPressDrag(page, { x: quick!.x + 150, y: quick!.y + quick!.height / 2 }, { x: quick!.x + 150, y: quick!.y - 120 }, 60);
    await release();
    await page.waitForTimeout(1500); // a inércia do deslize termina antes do próximo gesto
    expect((await projectState(api, seed.id)).order(seed.sections.Planejar)).toEqual(before);

    const source = await row(page, "Listar móveis para doação").boundingBox();
    const target = await row(page, "Definir orçamento da reforma").boundingBox();
    const drop = await longPressDrag(page, { x: source!.x + 150, y: source!.y + source!.height / 2 }, { x: target!.x + 150, y: target!.y + 6 });
    await expect(page.locator(".ins")).toBeVisible();
    await drop();
    await expect.poll(async () => (await projectState(api, seed.id)).order(seed.sections.Planejar))
      .toEqual(["Listar móveis para doação", "Definir orçamento da reforma", "Escolher a cor da pintura do quarto"]);
  });

  test("navega pela aba Navegar até o projeto e troca a visualização", async ({ page, api }) => {
    const name = `Navegar ${Date.now()}`;
    const seed = await seedProject(api, name);
    await page.goto("/hoje");
    const tabs = page.getByRole("navigation", { name: "Navegação" });
    await expect(tabs.getByRole("link")).toHaveText(["Entrada", "Hoje", "Em breve", "Navegar"]);
    await tabs.getByRole("link", { name: "Navegar" }).click();
    await page.waitForURL("**/navegar");
    await expect(page.getByRole("button", { name: "Abrir navegação" })).toHaveCount(0);
    const projects = page.getByRole("list", { name: "Meus projetos" });
    await expect(projects).toBeVisible();
    await projects.getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await page.waitForURL(`**/projetos/${seed.id}`);
    await expect(tabs.getByRole("link", { name: "Navegar" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: /Mostrar: Lista/ }).click();
    const sheet = page.getByRole("dialog", { name: "Visualização" });
    await expect(sheet.getByRole("radio", { name: "Lista" })).toBeChecked();
    await sheet.getByRole("radio", { name: "Painel" }).click();
    await sheet.getByRole("button", { name: "Fechar (Esc)" }).click();
    await expect(page.getByRole("tablist", { name: "Colunas" })).toBeVisible();
    await page.getByRole("tab", { name: /^Comprar ·/ }).click();
    await expect(row(page, "Kit de ferramentas")).toBeInViewport({ ratio: 0.9 });
    await expect(page.getByRole("heading", { name, level: 1 })).toBeInViewport();
    await expect(page.locator(".add-sec-m")).toHaveCount(0);
    await page.getByRole("button", { name: /Mostrar: Painel/ }).click();
    await sheet.getByRole("radio", { name: "Lista" }).click();
    await sheet.getByRole("button", { name: "Fechar (Esc)" }).click();
    await expect(page.locator(".add-sec-m")).toBeVisible();
    await page.getByRole("button", { name: "Voltar" }).click();
    await page.waitForURL("**/navegar");
    await page.getByRole("link", { name: "Buscar" }).click();
    await page.waitForURL("**/busca");
  });
});

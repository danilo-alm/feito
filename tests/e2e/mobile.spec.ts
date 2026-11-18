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

  test("navega pela barra inferior, gaveta de projetos e folha de visualização", async ({ page, api }) => {
    const seed = await seedProject(api, `Gaveta ${Date.now()}`);
    await page.goto("/hoje");
    await page.getByRole("navigation", { name: "Navegação" }).getByRole("button", { name: "Projetos" }).click();
    const drawer = page.getByRole("dialog", { name: "Navegação e projetos" });
    await drawer.getByRole("link", { name: new RegExp(`^Gaveta`) }).last().click();
    await page.waitForURL(`**/projetos/${seed.id}`);
    await page.getByRole("button", { name: /Visualização: Lista/ }).click();
    const sheet = page.getByRole("dialog", { name: "Visualização" });
    await expect(sheet.getByText("pressione e segure")).toBeVisible();
    await sheet.getByRole("radio", { name: "Painel" }).click();
    await sheet.getByRole("button", { name: "Fechar (Esc)" }).click();
    await expect(page.getByRole("tablist", { name: "Colunas" })).toBeVisible();
    await expect(page.locator(".add-sec-m")).toHaveCount(0);
    await page.getByRole("button", { name: /Visualização: Painel/ }).click();
    await sheet.getByRole("radio", { name: "Lista" }).click();
    await sheet.getByRole("button", { name: "Fechar (Esc)" }).click();
    await expect(page.locator(".add-sec-m")).toBeVisible();
  });
});

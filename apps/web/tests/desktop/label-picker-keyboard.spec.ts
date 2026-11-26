import { expect, type Page } from "@playwright/test";
import { handleLocal } from "../../../desktop/src/data/local";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

const title = "Medir a parede";
const keyboard = 380;

async function openTask(page: Page) {
  let workspace = newPortugueseWorkspace();
  for (const [path, body] of [
    ...["Casa", "Compras", "Mercado", "Obra", "Urgente", "Viagem"].map((name) => ["/labels", { name }] as const),
    ["/tasks", { title }] as const,
  ]) {
    const result = await handleLocal(workspace, { method: "POST", path, body });
    expect(result.status).toBeLessThan(400);
    workspace = result.workspace;
  }
  // O navegador de teste não abre teclado: a área visível é simulada, como no iOS e no Android,
  // em que o teclado a encolhe sem mudar a altura da janela.
  await page.addInitScript(() => {
    const view = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, scale: 1, width: 0, height: 0 });
    let covered = 0;
    Object.defineProperties(view, {
      width: { get: () => window.innerWidth },
      height: { get: () => window.innerHeight - covered },
    });
    Object.defineProperty(window, "visualViewport", { get: () => view });
    Object.assign(window, {
      showKeyboard: (height: number) => {
        covered = height;
        view.dispatchEvent(new Event("resize"));
      },
    });
  });
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  await page.goto("/#/entrada");
  await page.locator(".task .t-title").filter({ hasText: title }).tap();
  return page.getByRole("dialog", { name: title, exact: true });
}

test.describe("celular", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("o seletor de etiquetas fica acima do teclado ao criar uma etiqueta", async ({ page }) => {
    const detail = await openTask(page);
    await detail.getByRole("button", { name: "Etiquetas: adicionar etiqueta" }).tap();
    const popover = page.getByRole("dialog", { name: "Etiquetas", exact: true });
    const input = popover.getByLabel("Buscar ou criar etiqueta");
    await expect(input).toBeFocused();

    const showKeyboard = (height: number) => page.evaluate(
      (value) => (window as unknown as { showKeyboard: (height: number) => void }).showKeyboard(value), height);
    const expectAboveKeyboard = async () => {
      const visible = page.viewportSize()!.height - keyboard;
      for (const target of [popover, input]) {
        await expect.poll(async () => {
          const box = (await target.boundingBox())!;
          return box.y >= 0 && box.y + box.height <= visible;
        }).toBe(true);
      }
    };

    await showKeyboard(keyboard);
    await expectAboveKeyboard();
    await page.screenshot({ path: test.info().outputPath("etiquetas-com-teclado.png") });

    await input.fill("Jardim");
    await expectAboveKeyboard();
    await popover.getByRole("button", { name: "Criar “Jardim”" }).tap();
    await expect(popover.getByRole("option", { name: "Jardim" })).toHaveAttribute("aria-selected", "true");
    await expectAboveKeyboard();

    // Com ainda menos altura, o campo não sai do lugar: só a lista rola.
    await showKeyboard(600);
    const before = (await input.boundingBox())!;
    await popover.getByRole("listbox").evaluate((list) => list.scrollTo({ top: list.scrollHeight }));
    await expect(popover.getByRole("option", { name: "Viagem" })).toBeInViewport();
    expect((await input.boundingBox())!.y).toBe(before.y);
    expect(before.y + before.height).toBeLessThanOrEqual(page.viewportSize()!.height - 600);
  });
});

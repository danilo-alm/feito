import type { Page } from "@playwright/test";
import { expect, mouseDrag, row, seedProject, test } from "./fixtures";

// Movimento ligado: valida o mecanismo de presença (docs/04-motion-and-interaction.md).
test.use({ reducedMotion: "no-preference" });

async function openQuickAdd(page: Page, isMobile: boolean) {
  if (isMobile) await page.locator(".fab").click();
  else await page.keyboard.press("q");
}

test.describe("movimento", () => {
  test("ao soltar como subtarefa, a linha recupera a opacidade da prévia gradualmente", async ({ page, api, isMobile }) => {
    test.skip(isMobile, "A prévia transparente é usada no arraste com mouse.");
    const seed = await seedProject(api, `Transparência ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    const task = row(page, "Listar móveis para doação");
    const parent = row(page, "Definir orçamento da reforma");
    await task.scrollIntoViewIfNeeded();
    const from = (await task.boundingBox())!;
    const to = (await parent.boundingBox())!;
    await mouseDrag(page, { x: from.x + 200, y: from.y + from.height / 2 },
      { x: to.x + 200, y: to.y + to.height / 2 }, { locator: parent, zone: "center" });
    await expect(page.locator(".drag-overlay")).toHaveCSS("opacity", "0.2");
    await page.mouse.up();

    await expect.poll(() => task.evaluate((element) => element.getAnimations()
      .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes().map(({ opacity }) => opacity))
      .filter((opacity) => opacity !== undefined)),
    { intervals: [16, 32, 50] }).toEqual(["0.2", "1"]);
    await expect(task).toHaveCSS("opacity", "1");
  });

  test("o diálogo sai animado e só então desmonta; reabrir durante a saída reaproveita o nó", async ({ page, isMobile }) => {
    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
    const wrap = page.locator(".dialog-wrap");
    const dialog = page.getByRole("dialog", { name: "Adicionar tarefa" });

    await openQuickAdd(page, isMobile);
    await expect(dialog.getByLabel("Título da tarefa")).toBeFocused();
    await page.keyboard.press("Escape");
    // Saindo: continua no DOM, mas inerte e fora da árvore de acessibilidade.
    await expect(wrap).toHaveAttribute("data-state", "exiting");
    await expect(wrap).toHaveAttribute("inert", "");
    await expect(dialog).toBeHidden();
    await expect(wrap).toHaveCount(0);

    // Reabrir no meio da saída: um único nó, de volta ao estado aberto e com foco.
    await openQuickAdd(page, isMobile);
    await expect(wrap).toHaveAttribute("data-state", /entering|entered/);
    await page.keyboard.press("Escape");
    await expect(wrap).toHaveAttribute("data-state", "exiting");
    await openQuickAdd(page, isMobile);
    await expect(wrap).toHaveCount(1);
    await expect(wrap).not.toHaveAttribute("data-state", "exiting");
    await expect(dialog.getByLabel("Título da tarefa")).toBeFocused();
    await expect(wrap).toHaveAttribute("data-state", "entered");
    await page.keyboard.press("Escape");
    await expect(wrap).toHaveCount(0);
  });

  test("abrir e fechar um menu rapidamente não deixa nó preso nem duplicado", async ({ page, isMobile }) => {
    await page.goto("/entrada");
    const trigger = page.getByRole("button", { name: /Mostrar/ });
    await expect(trigger).toBeVisible();
    for (let index = 0; index < 5; index++) await trigger.click({ delay: 0, force: true });
    // Número ímpar de cliques: termina aberto, com um único nó.
    const overlay = page.locator(isMobile ? ".dialog-wrap" : ".popover");
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toHaveAttribute("data-state", "entered");
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("avisos saem em fade e a linha concluída sai sem salto", async ({ page, api }) => {
    const seed = await seedProject(api, `Movimento ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    const target = row(page, "Kit de ferramentas");
    await target.getByRole("button", { name: /^Concluir “Kit de ferramentas”/ }).click();
    const toast = page.locator(".toast-stack .toast").filter({ hasText: "Concluída" });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute("data-state", "exiting", { timeout: 6_000 });
    await expect(toast).toHaveCount(0);
    // Fantasmas de linhas removidas somem sozinhos.
    await expect(page.locator(".flip-ghost")).toHaveCount(0);
  });
});

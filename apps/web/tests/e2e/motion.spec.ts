import type { Page } from "@playwright/test";
import { expect, mouseDrag, projectState, row, seedProject, test } from "./fixtures";

// Movimento ligado: valida o mecanismo de presença (docs/04-motion-and-interaction.md).
test.use({ reducedMotion: "no-preference" });

async function openQuickAdd(page: Page, isMobile: boolean) {
  if (isMobile) await page.locator(".fab").click();
  else await page.keyboard.press("q");
}

test.describe("movimento", () => {
  test("tooltips aparecem rapidamente e esmaecem ao sair", async ({ page, isMobile }) => {
    test.skip(isMobile, "A entrada por ponteiro é exercitada com mouse.");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/entrada");
    const button = page.getByRole("button", { name: "Mostrar: Lista" });
    const tip = page.getByRole("tooltip");
    await expect(button).toBeVisible();
    await page.evaluate(() => {
      document.addEventListener("transitionrun", (event) => {
        if (event.propertyName !== "opacity" || !(event.target instanceof HTMLElement) || !event.target.matches(".tooltip")) return;
        const phase = event.target.dataset.state;
        if (phase === "entering") document.body.dataset.tooltipEntered = "true";
        if (phase === "exiting") document.body.dataset.tooltipExited = "true";
      });
    });
    await button.hover();
    await expect(tip).toHaveText("Mostrar: Lista", { timeout: 800 });
    await expect(tip).toHaveCSS("background-color", "rgb(44, 42, 39)");
    await expect(tip).toHaveCSS("color", "rgb(237, 233, 226)");
    await expect(page.locator("body")).toHaveAttribute("data-tooltip-entered", "true");
    await tip.hover();
    await expect(tip).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.locator("body")).toHaveAttribute("data-tooltip-exited", "true");
    await expect(page.locator(".tooltip")).toHaveCount(0);

    await page.keyboard.press("Tab");
    await button.focus();
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("toque abre o controle sem exibir tooltip", async ({ page, isMobile }) => {
    test.skip(!isMobile, "O perfil de celular usa entrada por toque.");
    await page.goto("/entrada");
    await page.getByRole("button", { name: "Mostrar: Lista" }).tap();
    await expect(page.getByRole("dialog", { name: "Visualização" })).toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("ao arrastar, as tarefas abrem espaço com animação e a linha solta não volta ao ponto de partida", async ({ page, api, isMobile }) => {
    test.skip(isMobile, "Arraste com mouse.");
    const seed = await seedProject(api, `Espaço ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    const task = row(page, "Listar móveis para doação");
    const budget = row(page, "Definir orçamento da reforma");
    await task.scrollIntoViewIfNeeded();
    const from = (await task.boundingBox())!;
    const to = (await budget.boundingBox())!;
    await mouseDrag(page, { x: from.x + 200, y: from.y + from.height / 2 }, { x: from.x + 200, y: to.y + 4 });
    const gap = page.locator(".drop-gap[data-open]");
    await expect(gap).toHaveCSS("transition-duration", "0.18s");
    await expect.poll(async () => Math.round((await gap.boundingBox())!.height)).toBe(Math.round(from.height));
    const shifted = (await budget.boundingBox())!;
    expect(shifted.y).toBeGreaterThanOrEqual(to.y + from.height - 1);
    await page.mouse.up();

    // Depois de soltar, o vizinho parte de onde estava afastado, sem saltar de volta à posição de antes do arraste.
    const starts = await budget.evaluate((element) => element.getAnimations()
      .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes().slice(0, 1).map(({ transform }) => transform)));
    for (const transform of starts) {
      const dy = Number(/translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(String(transform))?.[1] ?? 0);
      expect(Math.abs(dy)).toBeLessThan(from.height / 2);
    }
    await expect.poll(async () => (await projectState(api, seed.id)).order(seed.sections.Planejar))
      .toEqual(["Listar móveis para doação", "Definir orçamento da reforma", "Escolher a cor da pintura do quarto"]);
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

  test("o aviso de conclusão fica inerte enquanto sai em fade", async ({ page, api }) => {
    const seed = await seedProject(api, `Movimento ${Date.now()}`);
    await page.goto(`/projetos/${seed.id}`);
    const target = row(page, "Kit de ferramentas");
    await target.getByRole("button", { name: /^Concluir “Kit de ferramentas”/ }).click();
    const toast = page.locator(".toast-stack .toast").filter({ hasText: "Concluída" });
    await expect(toast).toBeVisible();
    // A saída dura menos que o intervalo de polling em algumas execuções.
    const exit = await toast.evaluate((node) => new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (node.getAttribute("data-state") !== "exiting") return;
        observer.disconnect();
        clearTimeout(timeout);
        const style = getComputedStyle(node);
        resolve({
          inert: node.hasAttribute("inert"), hidden: node.getAttribute("aria-hidden"),
          opacityTransition: style.transitionProperty.includes("opacity") && parseFloat(style.transitionDuration) > 0,
        });
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, 6_000);
      observer.observe(node, { attributes: true, attributeFilter: ["data-state"] });
    }));
    expect(exit).toEqual({ inert: true, hidden: "true", opacityTransition: true });
    await expect(toast).toHaveCount(0);
    await expect(target).toBeHidden();
    // Fantasmas de linhas removidas somem sozinhos.
    await expect(page.locator(".flip-ghost")).toHaveCount(0);
  });
});

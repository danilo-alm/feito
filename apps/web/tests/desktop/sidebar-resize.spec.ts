import { expect } from "@playwright/test";
import { mockDesktop, newPortugueseWorkspace, test } from "./fixtures";

test("menu acompanha cada movimento sem animação ou destaque verde", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: newPortugueseWorkspace() } });
  await page.goto("/#/hoje");
  const separator = page.getByRole("separator", { name: "Redimensionar menu lateral" });
  await expect(separator).toBeVisible();
  // Reproduz o arraste após uso do teclado, que antes deixava o foco persistente.
  await separator.focus();
  const bounds = (await separator.boundingBox())!;
  const start = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(start, y);
  await page.mouse.down();
  for (const offset of [48, 112, 24, 80]) {
    await page.mouse.move(start + offset, y);
    const geometry = await page.evaluate(() => new Promise<{ side: number; main: number; lead: number; expected: number }>((resolve) => {
      requestAnimationFrame(() => resolve({
        side: document.querySelector(".side")!.getBoundingClientRect().width,
        main: document.querySelector(".main")!.getBoundingClientRect().left,
        lead: document.querySelector(".tb-lead")!.getBoundingClientRect().width,
        expected: parseFloat(document.documentElement.style.getPropertyValue("--sidebar-width")),
      }));
    }));
    expect(geometry.expected).toBeCloseTo(264 + offset, 0);
    expect(Math.abs(geometry.side - geometry.expected)).toBeLessThan(1);
    expect(Math.abs(geometry.main - geometry.expected)).toBeLessThan(1);
    expect(Math.abs(geometry.lead - geometry.expected)).toBeLessThan(1);
  }
  await page.mouse.up();
  await expect(separator).not.toBeFocused();
  await expect(separator).toHaveCSS("outline-style", "none");
  await expect.poll(() => separator.evaluate((element) => getComputedStyle(element, "::after").opacity)).toBe("0");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    const colors = await separator.evaluate((element) => ({
      line: getComputedStyle(element, "::after").backgroundColor,
      neutral: getComputedStyle(element).getPropertyValue("--border-strong").trim(),
    }));
    const neutral = await page.evaluate((color) => {
      const element = document.createElement("span");
      element.style.color = color;
      document.body.append(element);
      const resolved = getComputedStyle(element).color;
      element.remove();
      return resolved;
    }, colors.neutral);
    expect(colors.line).toBe(neutral);
    await page.screenshot({ path: info.outputPath(`sidebar-resized-${colorScheme}.png`) });
    // A indicação de foco continua disponível para quem usa o teclado.
    await page.keyboard.press("Tab");
    await separator.focus();
    await expect(separator).toHaveCSS("outline-color", neutral);
    await separator.evaluate((element) => (element as HTMLElement).blur());
  }
});

test("menu redimensiona, preserva a largura e mantém ações e nomes longos acessíveis", async ({ page }, info) => {
  const workspace = newPortugueseWorkspace();
  const name = "Planejamento de todos os projetos pessoais e profissionais do próximo semestre";
  workspace.projects.push({ ...workspace.projects[0], id: crypto.randomUUID(), isInbox: false,
    data: { ...workspace.projects[0].data, name } });
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  await page.goto("/#/hoje");
  const separator = page.getByRole("separator", { name: "Redimensionar menu lateral" });
  const sidebar = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(separator).toBeVisible();
  await separator.focus();
  await separator.press("Home");
  const min = Number(await separator.getAttribute("aria-valuemin"));
  await expect(sidebar).toHaveCSS("flex-basis", `${min}px`);
  const add = sidebar.getByRole("button", { name: "Adicionar tarefa" });
  expect(await add.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await add.click();
  await expect(page.getByRole("dialog", { name: "Adicionar tarefa" })).toBeVisible();
  await page.keyboard.press("Escape");
  const project = sidebar.getByRole("link", { name });
  await expect(project.locator(".nav-name")).toHaveClass(/nav-name-truncated/);
  await expect(project.locator(".nav-name")).toHaveCSS("text-overflow", "ellipsis");
  await project.locator("..").hover();
  await sidebar.getByRole("button", { name: `Ações de ${name}` }).click();
  await expect(page.getByRole("menuitem", { name: "Editar projeto", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: info.outputPath(`sidebar-min-${colorScheme}.png`) });
  }
  const bounds = (await separator.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(900, bounds.y + bounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "440");
  await expect(sidebar).toHaveCSS("flex-basis", "440px");
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "432");
  await page.reload();
  await expect(sidebar).toHaveCSS("flex-basis", "432px");
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(separator).toHaveAttribute("aria-valuenow", "405");
  await expect(page.locator(".main")).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(separator).toBeHidden();
  await expect(sidebar).toBeHidden();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: info.outputPath(`sidebar-mobile-${colorScheme}.png`) });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1180, height: 800 });
  await expect(sidebar).toHaveCSS("flex-basis", "432px");
  await page.getByRole("button", { name: "Recolher menu lateral" }).click();
  await expect(separator).toBeHidden();
  await page.getByRole("button", { name: "Mostrar menu lateral" }).click();
  await expect(separator).toBeVisible();
  await expect(sidebar).toHaveCSS("flex-basis", "432px");
});

for (const titlebar of [false, true]) {
  test(`menu com muitos projetos ${titlebar ? "com" : "sem"} faixa de título`, async ({ page }) => {
    const workspace = newPortugueseWorkspace();
    for (let index = 0; index < 35; index++) {
      workspace.projects.push({ ...workspace.projects[0], id: crypto.randomUUID(), isInbox: false,
        data: { ...workspace.projects[0].data, name: `Projeto ${index} com um nome que ocupa toda a largura disponível` } });
    }
    await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
    // Mantém a ponte nativa, usando a mesma estrutura de menu do web, sem a faixa do Tauri.
    if (!titlebar) await page.addInitScript(() => Object.defineProperty(navigator, "userAgent", { value: "Feito Browser" }));
    await page.goto("/#/hoje");
    const separator = page.getByRole("separator", { name: "Redimensionar menu lateral" });
    const sidebar = page.getByRole("navigation", { name: "Navegação principal" });
    await separator.press("Home");
    const add = sidebar.getByRole("button", { name: "Adicionar tarefa" });
    expect(await add.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const label = sidebar.locator(".side-add-label");
    const labelBounds = (await label.boundingBox())!;
    const sideBounds = (await sidebar.boundingBox())!;
    expect(labelBounds.x + labelBounds.width).toBeLessThan(sideBounds.x + sideBounds.width - 12);
    await sidebar.getByRole("link", { name: "Ajustes" }).scrollIntoViewIfNeeded();
    await expect(separator).toBeInViewport();
    await separator.press("End");
    await expect(sidebar).toHaveCSS("flex-basis", "440px");
  });
}

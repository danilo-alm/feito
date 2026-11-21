import { expect, test } from "@playwright/test";

test("reabre e grava no espaço sem conta sem rede depois da preparação", async ({ page, context, isMobile }) => {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Usar neste navegador, sem conta" }).click();
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  await page.goto("/ajustes");
  const settings = page.getByRole("region", { name: "Acesso offline" });
  await expect(settings.getByRole("status")).toHaveText("Pronto para uso offline neste navegador.", { timeout: 25_000 });
  const dark = page.getByRole("radio", { name: "Escuro" });
  await dark.click();
  await expect(dark).toBeChecked();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  const files = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("feito:static:"));
    return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map(({ url }) => new URL(url).pathname)))).flat();
  });
  expect(files).toContainEqual(expect.stringMatching(/\/_next\/static\/[^/]+\/feito-shell\.html$/));
  expect(files.some((path) => path.startsWith("/api/") || path.startsWith("/compartilhado/") || path === "/entrar")).toBe(false);

  await page.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  const navigation = await reopened.goto("/em-breve");
  expect(navigation?.fromServiceWorker()).toBe(true);
  await expect(reopened.getByRole("heading", { name: "Em breve", level: 1 })).toBeVisible();
  await expect(reopened.locator("html")).toHaveClass(/\bdark\b/);
  expect(await reopened.evaluate(() => fetch("/api/health/live").then(() => true, () => false))).toBe(false);

  const nav = reopened.getByRole("navigation", { name: isMobile ? "Navegação" : "Navegação principal", exact: true });
  await nav.getByRole("link", { name: isMobile ? "Entrada" : "Caixa de entrada", exact: true }).click();
  await expect(reopened.getByRole("heading", { name: "Caixa de entrada", level: 1 })).toBeVisible();
  if (isMobile) await reopened.locator("button[aria-label='Adicionar tarefa']").click();
  else await reopened.keyboard.press("q");
  const editor = reopened.getByRole("dialog", { name: "Adicionar tarefa" });
  const title = editor.getByLabel("Título da tarefa");
  await expect(title).toBeFocused();
  await title.fill("Enviar orçamento sem conexão");
  await title.press("Enter");
  await expect(reopened.getByText(/Tarefa adicionada/)).toBeVisible();
  await reopened.reload();
  const complete = reopened.getByRole("button", { name: /^Concluir “Enviar orçamento sem conexão”/ });
  await expect(complete).toBeVisible();

  await context.setOffline(false);
  await reopened.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("feito:static:"));
    await Promise.all(names.map((name) => caches.delete(name)));
  });
  await reopened.reload();
  await expect(complete).toBeVisible();
  await context.setOffline(true);
  await reopened.reload();
  await expect(complete).toBeVisible();

  if (isMobile) await nav.getByRole("link", { name: "Navegar" }).click();
  await reopened.getByRole("button", { name: "Novo projeto" }).click();
  const project = reopened.getByRole("dialog", { name: "Novo projeto" });
  await project.getByRole("textbox", { name: "Nome do projeto" }).fill("Planejamento offline");
  await project.getByRole("button", { name: "Criar projeto" }).click();
  await expect(reopened).toHaveURL(/\/projetos\/[\da-f-]+$/);
  const deepLink = await context.newPage();
  const deepNavigation = await deepLink.goto(reopened.url());
  expect(deepNavigation?.fromServiceWorker()).toBe(true);
  await expect(deepLink.getByRole("heading", { name: "Planejamento offline", level: 1 })).toBeVisible();
});

test("aguarda as abas abertas para atualizar e preserva edições locais", async ({ page, context, request, isMobile }) => {
  test.skip(!process.env.FEITO_E2E_KEY && process.env.FEITO_E2E_LOCAL_SERVER !== "1", "A troca de versão usa o servidor HTTPS local dos testes.");
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Usar neste navegador, sem conta" }).click();
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  await page.goto("/entrada");
  await expect(page.getByRole("heading", { name: "Caixa de entrada", level: 1 })).toBeVisible();
  if (isMobile) await page.locator("button[aria-label='Adicionar tarefa']").click();
  else await page.keyboard.press("q");
  const title = page.getByRole("dialog", { name: "Adicionar tarefa" }).getByLabel("Título da tarefa");
  await title.fill("Salvar antes de atualizar");

  const settings = await context.newPage();
  await settings.goto("/ajustes");
  const offline = settings.getByRole("region", { name: "Acesso offline" });
  await expect(offline.getByRole("status")).toHaveText("Pronto para uso offline neste navegador.", { timeout: 25_000 });
  expect((await request.post("/__e2e/worker-update?active=1")).status()).toBe(204);
  try {
    await offline.getByRole("button", { name: "Verificar atualização" }).click();
    await expect(offline.getByRole("status")).toHaveText(/Atualização disponível/, { timeout: 25_000 });
    await expect(title).toHaveValue("Salvar antes de atualizar");
    await title.press("Enter");
    await expect(page.getByText(/Tarefa adicionada/)).toBeVisible();
    await page.close();
    await settings.close();

    await expect.poll(async () => {
      const worker = context.serviceWorkers().at(-1);
      if (!worker) return [];
      return await worker.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith("feito:static:"))).catch(() => []);
    }).toEqual([expect.stringMatching(/-e2e$/)]);

    await context.setOffline(true);
    const reopened = await context.newPage();
    await reopened.goto("/entrada");
    await expect(reopened.getByRole("button", { name: /^Concluir “Salvar antes de atualizar”/ })).toBeVisible();
  } finally {
    expect((await request.post("/__e2e/worker-update?active=0")).status()).toBe(204);
  }
});

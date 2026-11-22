import { expect, test } from "@playwright/test";

// Isola os pedidos feitos pela página da preparação completa do pacote offline.
test.use({ serviceWorkers: "block", storageState: { cookies: [], origins: [] } });

test("busca e ajustes carregam código somente ao abrir suas telas", async ({ page, isMobile }) => {
  const scripts = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.add(request.url());
  });
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Use in this browser without an account" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  const initial = new Set(scripts);

  if (isMobile) {
    await page.getByRole("navigation", { name: "Navigation", exact: true }).getByRole("link", { name: "Browse", exact: true }).click();
  }
  await page.getByRole("link", { name: /^Search(?: \/)?$/ }).click();
  await expect(page.getByRole("searchbox", { name: "Search tasks by title or description", exact: true })).toBeVisible();
  expect([...scripts].some((url) => !initial.has(url))).toBe(true);
  const afterSearch = new Set(scripts);

  if (isMobile) await page.getByRole("navigation", { name: "Navigation", exact: true }).getByRole("link", { name: "Browse", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  expect([...scripts].some((url) => !afterSearch.has(url))).toBe(true);
});

test("tenta novamente quando o arquivo de uma tela falha", async ({ page, isMobile }) => {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Use in this browser without an account" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  if (isMobile) {
    await page.getByRole("navigation", { name: "Navigation", exact: true }).getByRole("link", { name: "Browse", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Browse", exact: true })).toBeVisible();
  }
  await page.route("**/_next/static/chunks/*.js", (route) => route.abort());
  await page.getByRole("link", { name: /^Search(?: \/)?$/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not load Feito." })).toBeVisible();
  await page.unroute("**/_next/static/chunks/*.js");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search tasks by title or description", exact: true })).toBeVisible();
});

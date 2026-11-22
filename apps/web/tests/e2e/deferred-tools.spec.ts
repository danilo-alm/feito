import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

async function openWorkspace(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Use in this browser without an account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

async function createProject(page: Page, isMobile: boolean, name: string) {
  if (isMobile) await page.getByRole("link", { name: "Browse", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New project", exact: true });
  await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function openProjectTool(page: Page, name: "Import…" | "Export…") {
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function addDescription(page: Page, isMobile: boolean, source: string) {
  if (isMobile) await page.getByRole("button", { name: "Add task", exact: true }).click();
  else await page.keyboard.press("q");
  const dialog = page.getByRole("dialog", { name: "Add task", exact: true });
  await dialog.getByRole("textbox", { name: "Task title", exact: true }).fill("Lazy description");
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill(source);
  return dialog;
}

test.describe("ferramentas sob demanda", () => {
  test.use({ serviceWorkers: "block" });

  for (const tool of ["Import…", "Export…"] as const) {
    test(`permite fechar ${tool} durante o carregamento e reabrir com foco`, async ({ page, isMobile }) => {
      await openWorkspace(page);
      await createProject(page, isMobile, "Deferred tools");
      await page.emulateMedia({ colorScheme: isMobile ? "dark" : "light" });
      const requested = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      await page.route("**/_next/static/chunks/*.js", async (route) => {
        requested.resolve();
        await release.promise;
        await route.continue();
      });
      try {
        await openProjectTool(page, tool);
        await requested.promise;
        const dialog = page.getByRole("dialog", { name: "Deferred tools", exact: true });
        await expect(dialog.getByRole("status", { name: "Loading", exact: true })).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Close (Esc)", exact: true })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeFocused();
      } finally {
        release.resolve();
      }
      await openProjectTool(page, tool);
      const dialog = page.getByRole("dialog", { name: "Deferred tools", exact: true });
      if (tool === "Import…") await expect(dialog.locator('input[type="file"]')).toBeAttached();
      else await expect(dialog.getByRole("button", { name: "Download CSV", exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close (Esc)", exact: true })).toBeFocused();
      await page.screenshot({ path: test.info().outputPath(`deferred-${tool === "Import…" ? "import" : "export"}.png`), fullPage: true });
    });
  }

  test("carrega Markdown só quando aparece texto e preserva edições feitas durante a espera", async ({ page, isMobile }) => {
    await openWorkspace(page);
    const requested = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await page.route("**/_next/static/chunks/*.js", async (route) => {
      requested.resolve();
      await release.promise;
      await route.continue();
    });
    const dialog = await addDescription(page, isMobile, "**Original**");
    await dialog.getByRole("textbox", { name: "Task title", exact: true }).click();
    try {
      await requested.promise;
      const preview = dialog.getByRole("region", { name: "Description", exact: true });
      await expect(preview).toContainText("**Original**");
      await expect(preview.locator("strong")).toHaveCount(0);
      await preview.click();
      const input = dialog.getByRole("textbox", { name: "Description", exact: true });
      await input.fill("**Latest text**");
      release.resolve();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("**Latest text**");
      await dialog.getByRole("textbox", { name: "Task title", exact: true }).click();
      await expect(preview.locator("strong")).toHaveText("Latest text");
    } finally {
      release.resolve();
    }
  });

  test("mantém a descrição legível após falha e permite repetir a formatação pelo teclado", async ({ page, isMobile }) => {
    await openWorkspace(page);
    await page.route("**/_next/static/chunks/*.js", (route) => route.abort());
    const dialog = await addDescription(page, isMobile, "**Readable text**");
    await dialog.getByRole("textbox", { name: "Task title", exact: true }).click();
    const preview = dialog.getByRole("region", { name: "Description", exact: true });
    await expect(preview).toContainText("**Readable text**");
    await expect(preview.getByRole("alert")).toHaveText("Could not format the description.");
    await page.unroute("**/_next/static/chunks/*.js");
    const retry = preview.getByRole("button", { name: "Try again", exact: true });
    await retry.focus();
    await retry.press("Enter");
    await expect(preview.locator("strong")).toHaveText("Readable text");
    await expect(preview).toBeFocused();
  });
});

test("importa, exporta e formata descrições pela primeira vez sem rede", async ({ page, context, isMobile }) => {
  await openWorkspace(page);
  await page.goto("/ajustes");
  await expect(page.getByRole("status").filter({ hasText: "Ready for offline use in this browser." })).toBeVisible({ timeout: 25_000 });
  await createProject(page, isMobile, "Offline tools");
  await context.setOffline(true);
  await openProjectTool(page, "Import…");
  const dialog = page.getByRole("dialog", { name: "Offline tools", exact: true });
  const header = "TYPE,CONTENT,DESCRIPTION,ICON,IS_COLLAPSED,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG,REMINDER_TYPE,REMINDER_OFFSET,REMINDER_DATE,REMINDER_DATE_LANG";
  const fields = Array<string>(20).fill("");
  fields[0] = "task"; fields[1] = "Imported offline"; fields[2] = "**Offline description**"; fields[5] = "4"; fields[6] = "1";
  await dialog.locator('input[type="file"]').setInputFiles({ name: "offline.csv", mimeType: "text/csv", buffer: Buffer.from(header + "\n" + fields.join(",") + "\n") });
  await dialog.getByRole("button", { name: "Import 1 task", exact: true }).click();
  await expect(page.getByText("Import completed", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close (Esc)", exact: true }).click();
  await expect(page.locator(".task strong")).toHaveText("Offline description");

  await openProjectTool(page, "Export…");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Offline tools.csv");
  expect(await readFile((await download.path())!, "utf8")).toContain("Imported offline");
  await page.reload();
  await page.getByRole("button", { name: /^Imported offline/ }).click();
  const detail = page.getByRole("dialog", { name: "Imported offline", exact: true });
  await expect(detail.getByRole("region", { name: "Description", exact: true }).locator("strong")).toHaveText("Offline description");
});

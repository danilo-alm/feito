import { expect } from "@playwright/test";
import { newWorkspace } from "../../../desktop/src/data/local";
import { mockDesktop, test } from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

test("aguarda o idioma do espaço antes de exibir as tarefas", async ({ page }) => {
  const workspace = newWorkspace();
  workspace.preferences.locale = "de";
  await mockDesktop(page, { generation: 1, value: { version: 1, active: "local", local: workspace } });
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(/\/(?:assets\/de-[^/]+\.js|i18n\/de\.json)(?:\?.*)?$/, async (route) => {
    requested.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await page.goto("/#/hoje");
    await requested.promise;
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("status", { name: "Loading", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^(Today|Heute)$/ })).toHaveCount(0);
  } finally {
    release.resolve();
  }
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { name: "Heute", exact: true })).toBeVisible();
});

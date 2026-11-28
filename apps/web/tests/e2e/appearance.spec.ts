import { expect, test } from "@playwright/test";
import { openPortugueseLocalWorkspace } from "./fixtures";

test("personaliza o destaque apenas quando o tema ativo é do Feito", async ({ page, isMobile }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/entrar");
  await openPortugueseLocalWorkspace(page);
  await page.goto("/ajustes");

  const root = page.locator("html");
  const trigger = page.getByRole("button", { name: /^Cor de destaque/ });
  const palette = page.getByRole("dialog", { name: "Cor de destaque" });
  const green = palette.getByRole("button", { name: "Verde", exact: true });
  const teal = palette.getByRole("button", { name: "Verde-azulado" });
  const orange = palette.getByRole("button", { name: "Laranja" });
  await expect(trigger).toHaveText("Verde");
  await expect(palette).toBeHidden();
  await trigger.click();
  await expect(palette.getByRole("button")).toHaveCount(12);
  await expect(palette).toHaveText("");
  await expect(green).toHaveAttribute("aria-pressed", "true");
  if (isMobile) await teal.tap();
  else {
    await expect(green).toBeFocused();
    await green.press("ArrowRight");
    await expect(teal).toBeFocused();
    await teal.press("Enter");
    await expect(trigger).toBeFocused();
  }
  await expect(trigger).toHaveText("Verde-azulado");
  await expect(palette).toBeHidden();
  await expect(root).toHaveCSS("--accent", /^#0f766e$/i);

  const light = page.getByRole("radiogroup", { name: "Quando o sistema estiver claro" });
  await light.getByRole("radio", { name: "Catppuccin Latte" }).click();
  await expect(root).toHaveAttribute("data-theme", "catppuccin-latte");
  await expect(root).toHaveCSS("--accent", /^#2f7d1e$/i);
  await expect(trigger).toBeDisabled();
  await expect(trigger).toHaveAccessibleDescription("O tema atual usa uma cor de destaque própria.");
  await expect(palette).toBeHidden();

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "feito-dark");
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveText("Verde-azulado");
  await trigger.click();
  await expect(teal).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(trigger).toBeFocused();

  const dark = page.getByRole("radiogroup", { name: "Quando o sistema estiver escuro" });
  await dark.getByRole("radio", { name: "Feito Preto" }).click();
  await expect(root).toHaveAttribute("data-theme", "feito-black");
  await trigger.click();
  await orange.click();
  await expect(trigger).toHaveText("Laranja");
  await expect(root).toHaveCSS("--accent", /^#fb923c$/i);

  await page.reload();
  await expect(trigger).toHaveText("Laranja");
  await expect(root).toHaveAttribute("data-theme", "feito-black");

  const followSystem = page.getByRole("switch", { name: "Seguir o sistema" });
  await followSystem.click();
  await expect(followSystem).not.toBeChecked();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "feito-black");
  await expect(trigger).toBeEnabled();
});

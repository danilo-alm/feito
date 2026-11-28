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
  const sky = palette.getByRole("button", { name: "Azul céu" });
  await expect(trigger).toHaveText("Verde");
  await expect(palette).toBeHidden();
  await trigger.click();
  await expect(palette.getByRole("button")).toHaveCount(20);
  await expect(palette.getByRole("button").last()).toHaveAccessibleName("Cor personalizada");
  await expect(palette.getByRole("button", { name: "Grafite" })).toHaveCount(0);
  await expect(palette).toHaveText("");
  await expect(green).toHaveAttribute("aria-pressed", "true");
  await expect(green.locator(".accent-swatch")).toHaveCSS("width", "20px");
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
  await sky.click();
  await expect(trigger).toHaveText("Azul céu");
  await expect(root).toHaveCSS("--accent", /^#38bdf8$/i);

  await page.reload();
  await expect(trigger).toHaveText("Azul céu");
  await expect(root).toHaveAttribute("data-theme", "feito-black");

  const followSystem = page.getByRole("switch", { name: "Seguir o sistema" });
  await followSystem.click();
  await expect(followSystem).not.toBeChecked();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "feito-black");
  await expect(trigger).toBeEnabled();

  await trigger.click();
  await palette.getByRole("button", { name: "Cor personalizada" }).click();
  const editor = page.getByRole("dialog", { name: "Cor personalizada" });
  const hex = editor.getByRole("textbox", { name: "Código hexadecimal" });
  await expect(hex).toHaveValue("#38BDF8");
  await editor.getByRole("slider", { name: "Matiz" }).press("ArrowRight");
  await expect(hex).not.toHaveValue("#38BDF8");
  await editor.getByRole("button", { name: "Cancelar" }).click();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText("Azul céu");

  await trigger.click();
  await palette.getByRole("button", { name: "Cor personalizada" }).click();
  const save = editor.getByRole("button", { name: "Salvar" });
  const plane = editor.locator(".accent-plane");
  const position = { x: 55, y: 80 };
  if (isMobile) await plane.tap({ position });
  else await plane.click({ position });
  await expect(hex).not.toHaveValue("#38BDF8");
  await hex.fill("#00");
  await expect(save).toBeDisabled();
  await hex.fill("#000000");
  await save.click();
  await expect(trigger).toHaveText("#000000");
  await expect(root).toHaveAttribute("data-accent", "custom");
  await expect(root).not.toHaveCSS("--accent", /^#000000$/i);
  await page.reload();
  await expect(trigger).toHaveText("#000000");
  await expect(root).toHaveAttribute("data-accent", "custom");
});

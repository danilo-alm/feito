import { DARK_THEMES, LIGHT_THEMES, type Accent, type DarkTheme, type LightTheme, type Preferences } from "@feito/core/types";

export type ThemeName = LightTheme | DarkTheme;

// Nomes próprios dos temas de editor ficam no original; só os temas do Feito são traduzidos.
const NAMES: Record<ThemeName, string> = {
  "feito-light": "Feito Claro",
  "feito-dark": "Feito Escuro",
  "feito-black": "Feito Preto",
  "catppuccin-latte": "Catppuccin Latte",
  "catppuccin-mocha": "Catppuccin Mocha",
  "catppuccin-macchiato": "Catppuccin Macchiato",
  "monokai-pro-spectrum": "Monokai Pro Spectrum",
  dracula: "Dracula",
  nord: "Nord",
  "tokyo-night": "Tokyo Night",
  "gruvbox-dark": "Gruvbox Dark",
  "one-dark": "One Dark",
  "rose-pine": "Rosé Pine",
  "solarized-light": "Solarized Light",
  "solarized-dark": "Solarized Dark",
};

export const lightThemes: readonly LightTheme[] = LIGHT_THEMES;
export const darkThemes: readonly DarkTheme[] = DARK_THEMES;

export const isFeitoTheme = (theme: ThemeName) => theme.startsWith("feito-");
export const isLightTheme = (theme: ThemeName): theme is LightTheme => (LIGHT_THEMES as readonly string[]).includes(theme);
export const systemColorScheme = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Nome exibido; os temas do Feito passam pela tradução. */
export const themeName = (theme: ThemeName, t: (text: string) => string) => isFeitoTheme(theme) ? t(NAMES[theme]) : NAMES[theme];

export const chosenLight = (preferences: Preferences): LightTheme => preferences.lightTheme ?? "feito-light";
export const chosenDark = (preferences: Preferences): DarkTheme => preferences.darkTheme ?? "feito-dark";
export const chosenAccent = (preferences: Preferences): Accent => preferences.accent ?? "green";

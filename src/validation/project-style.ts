// Cores e ícones que o usuário pode escolher para um projeto. Os valores visuais ficam em
// src/components/project-style.tsx (ícones) e globals.css (--proj-<cor>, clara e escura).
export const PROJECT_COLORS = [
  "cereja", "vermelho", "coral", "salmao", "laranja", "terracota", "ambar", "amarelo",
  "oliva", "limao", "verde", "floresta", "menta", "turquesa", "petroleo", "ceu",
  "azul", "marinho", "indigo", "uva", "violeta", "lavanda", "magenta", "rosa",
  "marrom", "taupe", "grafite", "cinza",
] as const;

export const PROJECT_ICONS = [
  "hash", "folder", "briefcase", "home", "book", "graduation", "bookmark", "pencil",
  "heart", "star", "flag", "target", "bulb", "rocket", "trophy", "bolt",
  "fire", "code", "terminal", "chart", "wallet", "coin", "cart", "gift",
  "plane", "car", "bike", "pin", "globe", "mountain", "leaf", "plant",
  "sun", "moon", "cloud", "coffee", "utensils", "music", "headphones", "camera",
  "film", "gamepad", "palette", "dumbbell", "pulse", "medical", "paw", "smile",
  "user", "users", "chat", "mail", "calendar", "clock", "box", "wrench",
  "shield", "lock",
] as const;

export type ProjectColor = typeof PROJECT_COLORS[number];
export type ProjectIcon = typeof PROJECT_ICONS[number];

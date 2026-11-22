// Estado exclusivo do cliente. O servidor sempre começa no idioma padrão para uma hidratação estável.
import { defaultLocale } from "@feito/core/domain/preferences";
import type { Locale } from "@feito/core/types";
import { locales } from "@feito/core/validation/preferences";
import english from "../i18n/en.json";

export const DEFAULT_LOCALE: Locale = defaultLocale;
// Cada idioma aparece com o próprio nome, para ser reconhecível em qualquer interface.
export const languages: readonly { value: Locale; label: string }[] = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "it", label: "Italiano" },
  { value: "de", label: "Deutsch" },
];
// As chaves são os textos em pt-BR; uma chave ausente num catálogo cai no português.
type Catalog = Readonly<Record<string, string>>;
type DeferredLocale = Exclude<Locale, "pt-BR" | "en">;
const catalogs: Partial<Record<Locale, Catalog>> = { en: english };
const loaders: Record<DeferredLocale, () => Promise<{ default: Catalog }>> = {
  "pt-PT": () => import("../i18n/pt-PT.json"),
  es: () => import("../i18n/es.json"),
  fr: () => import("../i18n/fr.json"),
  it: () => import("../i18n/it.json"),
  de: () => import("../i18n/de.json"),
};
const pending = new Map<Locale, Promise<void>>();
const STORAGE_KEY = "feito:locale";

/** Catálogos adicionais só são carregados ao usar o idioma; todos integram o pacote offline. */
export function loadLocale(locale: Locale): Promise<void> {
  if (locale === "pt-BR" || locale === "en" || catalogs[locale]) return Promise.resolve();
  const existing = pending.get(locale);
  if (existing) return existing;
  const request = loaders[locale]().then(({ default: entries }) => { catalogs[locale] = entries; })
    .finally(() => pending.delete(locale));
  pending.set(locale, request);
  return request;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
/** Etiqueta BCP 47 usada com `Intl`. O inglês segue o formato dia/mês e o relógio de 24 horas. */
export function intlLocale(locale: Locale = current) {
  return locale === "en" ? "en-GB" : locale;
}

let current: Locale = DEFAULT_LOCALE;
let localeRequest = 0;
const listeners = new Set<() => void>();
export const getLocale = () => current;
export const serverLocale = () => DEFAULT_LOCALE;
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export async function setLocale(locale: Locale): Promise<void> {
  // Nunca modifica estado global durante a renderização no servidor.
  if (typeof document === "undefined") return;
  if (!isLocale(locale)) locale = DEFAULT_LOCALE;
  const request = ++localeRequest;
  if (locale !== "pt-BR" && !catalogs[locale]) await loadLocale(locale);
  if (request !== localeRequest) return;
  document.documentElement.lang = locale;
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* Armazenamento opcional. */ }
  if (current === locale) return;
  current = locale;
  for (const listener of listeners) listener();
}
export function restoreLocale(): Promise<void> {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch { /* Armazenamento opcional; o catálogo padrão já está disponível. */ }
  return setLocale(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

/** Coloca um rótulo no meio da frase. Substantivos em alemão mantêm a inicial maiúscula. */
export function inSentence(text: string, locale: Locale = current) {
  return locale === "de" ? text : text.toLocaleLowerCase(intlLocale(locale));
}

function catalog(locale: Locale): Readonly<Record<string, string>> | undefined {
  return locale === "pt-BR" ? undefined : catalogs[locale];
}

/** Chaves em português preservam o fallback e mantêm os textos legíveis no código. */
export function translate(message: string, values: readonly (string | number | null | undefined)[] = [], locale: Locale = current): string {
  const entries = catalog(locale);
  const template = entries && Object.hasOwn(entries, message) ? entries[message] : message;
  return template.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? "") : token);
}

// Mensagens vindas da API continuam com os códigos e textos originais no transporte.
// A tradução acontece só ao exibi-las, incluindo parâmetros como nomes de arquivo.
// O catálogo em inglês é a referência de chaves; o teste garante que os outros têm as mesmas.
const messageTemplates = Object.keys(english).filter((key) => /\{\d+\}/.test(key)).map((key) => {
  const indices: number[] = [];
  const escaped = key.split(/(\{\d+\})/).map((part) => {
    const match = /^\{(\d+)\}$/.exec(part);
    if (match) { indices.push(Number(match[1])); return "([\\s\\S]*?)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return { key, indices, pattern: new RegExp(`^${escaped}$`) };
});
export function translateMessage(message: string, locale: Locale = current): string {
  const entries = catalog(locale);
  if (!entries) return message;
  if (Object.hasOwn(entries, message)) return translate(message, [], locale);
  for (const { key, indices, pattern } of messageTemplates) {
    const match = pattern.exec(message);
    if (!match) continue;
    const values: string[] = [];
    indices.forEach((index, capture) => {
      const value = match[capture + 1];
      // Avisos de importação usam contagens com um fragmento fixo; não traduz nomes de arquivos.
      const counted = /^(\d+) (.+)$/.exec(value);
      values[index] = counted && Object.hasOwn(entries, counted[2])
        ? `${counted[1]} ${translate(counted[2], [], locale)}` : value;
    });
    return translate(key, values, locale);
  }
  return message;
}

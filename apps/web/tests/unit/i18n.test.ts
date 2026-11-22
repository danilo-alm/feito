import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defaultLocale, defaultPreferences } from "@feito/core/domain/preferences";
import { preferences, preferencesPatch } from "@feito/core/validation/preferences";
import { getLocale, serverLocale, inSentence, languages, restoreLocale, setLocale, translate, translateMessage } from "@feito/ui/client/locale";
import {
  completedLabel, dateInSentence, dateLabel, longDate, monthShort, monthTitle, parseDueInput, rangeLabel, weekdayShort, weekHead,
} from "@feito/ui/client/dates";
import type { Locale } from "@feito/core/types";
import german from "../../../../packages/ui/src/i18n/de.json";
import english from "../../../../packages/ui/src/i18n/en.json";
import spanish from "../../../../packages/ui/src/i18n/es.json";
import french from "../../../../packages/ui/src/i18n/fr.json";
import italian from "../../../../packages/ui/src/i18n/it.json";
import portugal from "../../../../packages/ui/src/i18n/pt-PT.json";

const catalogs: Record<string, Record<string, string>> = { en: english, "pt-PT": portugal, es: spanish, fr: french, it: italian, de: german };
const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map(([token]) => token).sort();

const REF = "2026-11-19";

describe("idiomas compartilhados", () => {
  afterEach(async () => {
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
    await setLocale(defaultLocale);
    vi.unstubAllGlobals();
  });

  it("usa inglês sem preferência e preserva a escolha explícita de português", async () => {
    expect(defaultPreferences.locale).toBe("en");
    expect(serverLocale()).toBe("en");
    const stored = new Map<string, string>();
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    await restoreLocale();
    expect(getLocale()).toBe("en");
    expect(translate("Hoje")).toBe("Today");
    expect(parseDueInput("tomorrow", REF)).toBe("2026-11-20");
    stored.set("feito:locale", "pt-BR");
    await restoreLocale();
    expect(getLocale()).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(translate("Hoje")).toBe("Hoje");
  });

  it("preserva preferências antigas e não acrescenta idioma a patches de outros campos", () => {
    expect(preferences.parse({ timezone: "UTC", theme: "system" })).toEqual({ timezone: "UTC", theme: "system" });
    expect(preferencesPatch.parse({ theme: "dark" })).toEqual({ theme: "dark" });
    for (const locale of ["pt-BR", "pt-PT", "en", "es", "fr", "it", "de"]) expect(preferencesPatch.safeParse({ locale }).success).toBe(true);
    for (const locale of ["es-ES", "en-US", "pt", "xx", null, ""]) expect(preferencesPatch.safeParse({ locale }).success).toBe(false);
    expect(languages.map(({ value }) => value)).toEqual(["pt-BR", "pt-PT", "en", "es", "fr", "it", "de"]);
  });

  it("interpola sem traduzir conteúdo do usuário e tem fallback em português", async () => {
    expect(translate("Excluir “{0}”?", ["Hoje"], "en")).toBe("Delete “Hoje”?");
    expect(translate("texto futuro", [], "en")).toBe("texto futuro");
    expect(translate("Hoje", [], "pt-BR")).toBe("Hoje");
    expect(translateMessage("Já existe uma etiqueta com esse nome.", "en")).toBe("A label with this name already exists.");
    expect(translateMessage("Envie de 1 a 20 arquivos.", "en")).toBe("Send 1 to 20 files.");
    expect(translate("Excluir “{0}”?", ["Hoje"], "de")).toBe("“Hoje” löschen?");
    expect(translate("Caixa de entrada", [], "es")).toBe("Bandeja de entrada");
    expect(translate("Salvar", [], "pt-PT")).toBe("Guardar");
    expect(translate("Ajustes", [], "fr")).toBe("Réglages");
    expect(translate("Hoje", [], "it")).toBe("Oggi");
    for (const locale of Object.keys(catalogs) as Locale[]) expect(translate("texto futuro {0}", ["x"], locale)).toBe("texto futuro x");
    expect(translateMessage("Já existe uma etiqueta com esse nome.", "fr")).toBe("Une étiquette portant ce nom existe déjà.");
    expect(translateMessage("2 descrições foram cortadas no limite de 10 000 caracteres.", "es"))
      .toBe("2 descripciones se recortaron al límite de 10 000 caracteres.");
    expect(translateMessage("Mensagem nova do servidor.", "de")).toBe("Mensagem nova do servidor.");
  });

  it("restaura só idiomas conhecidos do armazenamento local", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("document", { documentElement: { lang: "pt-BR" } });
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    stored.set("feito:locale", "de");
    await restoreLocale();
    expect(getLocale()).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    stored.set("feito:locale", "klingon");
    await restoreLocale();
    expect(getLocale()).toBe("en");
    expect(stored.get("feito:locale")).toBe("en");
  });

  it("não altera o idioma global no servidor", async () => {
    await setLocale("pt-BR");
    expect(getLocale()).toBe("en");
  });

  it("formata datas no idioma escolhido, mantendo a data civil e o fuso", async () => {
    vi.stubGlobal("document", { documentElement: { lang: "pt-BR" } });
    await setLocale("en");
    expect(dateLabel(REF, REF)).toBe("Today");
    expect(dateLabel("2026-11-20", REF)).toBe("Tomorrow");
    expect(weekdayShort(REF)).toBe("Thu");
    expect(longDate(REF)).toBe("Thursday 19 November");
    expect(monthTitle(REF)).toBe("November 2026");
    expect(completedLabel("2026-11-20T01:30:00Z", REF, "America/Maceio")).toBe("Completed today, 22:30");
    await setLocale("pt-BR");
    expect(dateLabel(REF, REF)).toBe("Hoje");
    expect(longDate(REF)).toBe("Quinta, 19 de novembro");
    expect(weekHead()).toEqual(["D", "S", "T", "Q", "Q", "S", "S"]);
  });

  it.each([
    ["pt-PT", "Hoje", "Quinta, 19 de novembro", "Novembro de 2026", "Concluída hoje, 22:30"],
    ["es", "Hoy", "Jueves, 19 de noviembre", "Noviembre de 2026", "Completada hoy, 22:30"],
    ["fr", "Aujourd’hui", "Jeudi 19 novembre", "Novembre 2026", "Terminée aujourd’hui, 22:30"],
    ["it", "Oggi", "Giovedì 19 novembre", "Novembre 2026", "Completata oggi, 22:30"],
    ["de", "Heute", "Donnerstag, 19. November", "November 2026", "Heute erledigt, 22:30"],
  ] as const)("formata datas em %s sem deslocar a data civil", async (locale, today, long, month, completed) => {
    vi.stubGlobal("document", { documentElement: { lang: "pt-BR" } });
    await setLocale(locale);
    expect(document.documentElement.lang).toBe(locale);
    expect(dateLabel(REF, REF)).toBe(today);
    expect(longDate(REF)).toBe(long);
    expect(monthTitle(REF)).toBe(month);
    expect(completedLabel("2026-11-20T01:30:00Z", REF, "America/Maceio")).toBe(completed);
    expect(weekHead()).toHaveLength(7);
    expect(monthShort("2026-01-31", false)).not.toBe("");
    expect(rangeLabel("2026-11-30", "2026-12-06")).toMatch(/30.*6/);
    expect(dateLabel("2026-11-20", REF)).toBe(translate("Amanhã", [], locale));
  });

  it("ajusta maiúsculas no meio da frase conforme o idioma", async () => {
    vi.stubGlobal("document", { documentElement: { lang: "pt-BR" } });
    await setLocale("de");
    expect(inSentence("Priorität")).toBe("Priorität");
    expect(dateInSentence("Fr. 27 Nov.")).toBe("Fr. 27 Nov.");
    await setLocale("es");
    expect(inSentence("Prioridad")).toBe("prioridad");
    expect(dateInSentence("Vie 27 nov")).toBe("vie 27 nov");
    await setLocale("en");
    expect(dateInSentence("Fri 27 Nov")).toBe("Fri 27 Nov");
  });

  it.each([
    ["today", REF], ["tomorrow", "2026-11-20"], ["day after tomorrow", "2026-11-21"],
    ["next week", "2026-11-23"], ["this weekend", "2026-11-21"], ["next Friday", "2026-11-20"],
    ["in 3 days", "2026-11-22"], ["25 December", "2026-12-25"], ["Dec 25th", "2026-12-25"],
    ["25/12/2026", "2026-12-25"], ["2027-01-04", "2027-01-04"], ["February 30", null],
  ])("interpreta %s em inglês sem mudar o formato gravado", (input, expected) => {
    expect(parseDueInput(input!, REF, "en")).toBe(expected);
  });

  it.each([
    ["es", "hoy", REF], ["es", "mañana", "2026-11-20"], ["es", "pasado mañana", "2026-11-21"], ["es", "en 3 días", "2026-11-22"],
    ["es", "próximo viernes", "2026-11-20"], ["es", "25 de diciembre", "2026-12-25"], ["es", "25 mar", "2027-03-25"],
    ["es", "la semana que viene", "2026-11-23"],
    ["fr", "aujourd’hui", REF], ["fr", "demain", "2026-11-20"], ["fr", "après-demain", "2026-11-21"], ["fr", "dans 3 jours", "2026-11-22"],
    ["fr", "vendredi prochain", "2026-11-20"], ["fr", "ce week-end", "2026-11-21"], ["fr", "1er janvier", "2027-01-01"], ["fr", "25 décembre", "2026-12-25"],
    ["it", "oggi", REF], ["it", "dopodomani", "2026-11-21"], ["it", "tra 3 giorni", "2026-11-22"], ["it", "prossimo venerdì", "2026-11-20"],
    ["it", "25 dicembre", "2026-12-25"], ["it", "25 mar", "2027-03-25"], ["it", "prossima settimana", "2026-11-23"],
    ["de", "heute", REF], ["de", "morgen", "2026-11-20"], ["de", "übermorgen", "2026-11-21"], ["de", "in 3 Tagen", "2026-11-22"],
    ["de", "nächsten Freitag", "2026-11-20"], ["de", "25. Dezember", "2026-12-25"], ["de", "25.12.", "2026-12-25"], ["de", "1. März 2027", "2027-03-01"],
    ["pt-PT", "amanhã", "2026-11-20"], ["pt-PT", "25/12", "2026-12-25"],
    ["es", "30 de febrero", null], ["de", "irgendwann", null],
  ] as const)("interpreta vencimentos em %s: %s", (locale, input, expected) => {
    expect(parseDueInput(input, REF, locale)).toBe(expected);
  });

  it("cobre todas as chamadas de tradução e conserva os parâmetros entre idiomas", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(dir, entry.name);
      return entry.isDirectory() ? walk(path) : /\.tsx?$/.test(path) ? [path] : [];
    });
    for (const root of ["packages/ui/src", "apps/web/src/components", "apps/desktop/src"]) {
      for (const path of walk(fileURLToPath(new URL(`../../../../${root}`, import.meta.url)))) {
        for (const match of readFileSync(path, "utf8").matchAll(/\bt\(("(?:[^"\\]|\\.)*")/g)) {
          const key = JSON.parse(match[1]) as string;
          for (const [locale, catalog] of Object.entries(catalogs)) expect(Object.hasOwn(catalog, key), `${locale} ${path}: ${key}`).toBe(true);
        }
      }
    }
    for (const [locale, catalog] of Object.entries(catalogs)) {
      expect(Object.keys(catalog).sort(), locale).toEqual(Object.keys(english).sort());
      for (const [key, value] of Object.entries(catalog)) {
        expect(placeholders(value), `${locale}: ${key}`).toEqual(placeholders(key));
        expect(value.trim(), `${locale}: ${key}`).not.toBe("");
        // Fragmentos concatenados dependem dos espaços nas pontas.
        expect([value.startsWith(" "), value.endsWith(" ")], `${locale}: ${key}`).toEqual([key.startsWith(" "), key.endsWith(" ")]);
      }
    }
  });
});

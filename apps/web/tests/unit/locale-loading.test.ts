import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("document", { documentElement: { lang: "en" } });
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
});

afterEach(() => {
  vi.doUnmock("../../../../packages/ui/src/i18n/de.json");
  vi.doUnmock("../../../../packages/ui/src/i18n/fr.json");
  vi.unstubAllGlobals();
});

describe("carregamento dos catálogos", () => {
  it("compartilha o carregamento e só publica o idioma depois de pronto", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<{ default: Record<string, string> }>();
    const loader = vi.fn(() => { started.resolve(); return response.promise; });
    vi.doMock("../../../../packages/ui/src/i18n/de.json", loader);
    const { getLocale, loadLocale, setLocale, subscribeLocale, translate } = await import("@feito/ui/client/locale");
    const notify = vi.fn();
    const unsubscribe = subscribeLocale(notify);
    const first = loadLocale("de");
    expect(loadLocale("de")).toBe(first);
    const change = setLocale("de");
    await started.promise;
    expect(getLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    response.resolve({ default: { Hoje: "Heute" } });
    await Promise.all([first, change]);
    expect(getLocale()).toBe("de");
    expect(translate("Hoje")).toBe("Heute");
    expect(localStorage.setItem).toHaveBeenLastCalledWith("feito:locale", "de");
    await loadLocale("de");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("mantém a escolha mais recente quando os catálogos chegam fora de ordem", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<{ default: Record<string, string> }>();
    vi.doMock("../../../../packages/ui/src/i18n/de.json", () => { started.resolve(); return response.promise; });
    vi.doMock("../../../../packages/ui/src/i18n/fr.json", () => ({ default: { Hoje: "Aujourd’hui" } }));
    const { getLocale, setLocale, translate } = await import("@feito/ui/client/locale");
    const first = setLocale("de");
    await started.promise;
    await setLocale("fr");
    response.resolve({ default: { Hoje: "Heute" } });
    await first;
    expect(getLocale()).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(translate("Hoje")).toBe("Aujourd’hui");
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenLastCalledWith("feito:locale", "fr");
  });

  it("mantém o idioma anterior se o catálogo falhar e permite nova tentativa", async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error("Falha de rede"))
      .mockResolvedValue({ default: { Hoje: "Heute" } });
    vi.doMock("../../../../packages/ui/src/i18n/de.json", loader);
    const { getLocale, setLocale } = await import("@feito/ui/client/locale");
    await expect(setLocale("de")).rejects.toThrow();
    expect(getLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.setItem).not.toHaveBeenCalled();
    // O mock do Vitest também guarda falhas de avaliação do módulo.
    vi.doMock("../../../../packages/ui/src/i18n/de.json", () => ({ default: { Hoje: "Heute" } }));
    await setLocale("de");
    expect(getLocale()).toBe("de");
  });

  it("preserva a preferência armazenada quando a restauração falha", async () => {
    vi.mocked(localStorage.getItem).mockReturnValue("fr");
    vi.doMock("../../../../packages/ui/src/i18n/fr.json", () => { throw new Error("Sem catálogo"); });
    const { getLocale, restoreLocale } = await import("@feito/ui/client/locale");
    await expect(restoreLocale()).rejects.toThrow();
    expect(getLocale()).toBe("en");
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});

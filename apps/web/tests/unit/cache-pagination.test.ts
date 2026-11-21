import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { appendQueryData, clearCache, getQueryData, setQueryData, useQuery } from "@feito/ui/client/store";

type Page = { results: string[]; nextCursor: string | null };

function register(key: string, page: Page) {
  function Register() {
    useQuery(key, () => Promise.resolve(page));
    return null;
  }
  renderToString(createElement(Register));
  setQueryData(key, () => page);
}

afterEach(clearCache);

describe("paginação de leituras locais assíncronas", () => {
  it("mantém uma página atrasada no critério original ao trocar a busca", async () => {
    register("search:original", { results: ["anterior"], nextCursor: "mais" });
    const delayed = Promise.withResolvers<Page>();
    const loading = appendQueryData<Page>("search:original", () => delayed.promise);
    register("search:nova", { results: ["nova"], nextCursor: null });
    delayed.resolve({ results: ["anterior", "outra anterior"], nextCursor: null });
    await loading;
    expect(getQueryData<Page>("search:nova")?.results).toEqual(["nova"]);
    expect(getQueryData<Page>("search:original")?.results).toEqual(["anterior", "outra anterior"]);
  });

  it("descarta uma página antiga após logout e reabertura da mesma chave em outra conta", async () => {
    register("search:igual", { results: ["privada"], nextCursor: "mais" });
    const delayed = Promise.withResolvers<Page>();
    const loading = appendQueryData<Page>("search:igual", () => delayed.promise);
    clearCache();
    register("search:igual", { results: ["outra conta"], nextCursor: null });
    delayed.resolve({ results: ["privada", "outra privada"], nextCursor: null });
    await loading;
    expect(getQueryData<Page>("search:igual")?.results).toEqual(["outra conta"]);
  });
});

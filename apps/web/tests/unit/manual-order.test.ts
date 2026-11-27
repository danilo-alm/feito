import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { Label, Navigation } from "@feito/core/types";
import { inOrder, moveInOrder, moveInTree, subtreeIds, treeDepths, treeStep } from "@feito/ui/client/manual-order";
import { clearCache, getQueryData, setQueryData, useQuery } from "@feito/ui/client/store";

const label = (id: string): Label => ({ id, revision: 1, name: id, activeCount: 0 });
const nav = {
  inbox: { projectId: "inbox", activeCount: 0 }, todayCount: 0, archivedCount: 0, referenceDate: "2026-11-26",
  projects: ["a", "b", "c"].map((id) => ({ id, name: id })), labels: ["x", "y"].map(label),
} as unknown as Navigation;

function register<T>(key: string, value: T) {
  function Register() {
    useQuery(key, () => Promise.resolve(value));
    return null;
  }
  renderToString(createElement(Register));
  setQueryData(key, () => value);
}

const ids = (items: { id: string }[] | undefined) => items?.map((item) => item.id);

afterEach(clearCache);

describe("ordem manual de projetos e etiquetas", () => {
  it("ordena pelos ids e mantém no fim quem não aparece na resposta", () => {
    expect(ids(inOrder(["a", "b", "c", "d"].map(label), ["c", "a"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("mostra a ordem prevista na hora e aplica a ordem oficial da resposta", async () => {
    register("nav", nav);
    const response = Promise.withResolvers<string[]>();
    const moving = moveInOrder("projects", ["c", "a", "b"], () => response.promise);
    expect(ids(getQueryData<Navigation>("nav")?.projects)).toEqual(["c", "a", "b"]);
    response.resolve(["c", "b", "a"]);
    await moving;
    expect(ids(getQueryData<Navigation>("nav")?.projects)).toEqual(["c", "b", "a"]);
  });

  it("reordena as etiquetas da navegação e do seletor e desfaz só a previsão que falhou", async () => {
    register("nav", nav);
    register("labels", { labels: nav.labels });
    const response = Promise.withResolvers<string[]>();
    const moving = moveInOrder("labels", ["y", "x"], () => response.promise);
    expect(ids(getQueryData<Navigation>("nav")?.labels)).toEqual(["y", "x"]);
    expect(ids(getQueryData<{ labels: Label[] }>("labels")?.labels)).toEqual(["y", "x"]);
    response.reject(new Error("offline"));
    await expect(moving).rejects.toThrow("offline");
    expect(ids(getQueryData<Navigation>("nav")?.labels)).toEqual(["x", "y"]);
    expect(ids(getQueryData<{ labels: Label[] }>("labels")?.labels)).toEqual(["x", "y"]);
    expect(ids(getQueryData<Navigation>("nav")?.projects)).toEqual(["a", "b", "c"]);
  });
});

describe("árvore de projetos", () => {
  // a > a1 > a2, b
  const tree = [
    { id: "a", parentId: null }, { id: "a1", parentId: "a" }, { id: "a2", parentId: "a1" }, { id: "b", parentId: null },
  ];
  const shape = (items: { id: string; parentId: string | null }[]) => items.map(({ id, parentId }) => `${id}<${parentId ?? ""}`);

  it("calcula níveis e subárvores", () => {
    expect([...treeDepths(tree).values()]).toEqual([0, 1, 2, 0]);
    expect([...subtreeIds(tree, "a1")]).toEqual(["a1", "a2"]);
    expect([...subtreeIds(tree, "b")]).toEqual(["b"]);
  });

  it("move o item com os descendentes para outro pai", () => {
    expect(shape(moveInTree(tree, "b", { parentId: "a", afterId: "a1" }))).toEqual(["a<", "a1<a", "a2<a1", "b<a"]);
    expect(shape(moveInTree(tree, "a1", { parentId: null, afterId: "b" }))).toEqual(["a<", "b<", "a1<", "a2<a1"]);
    expect(shape(moveInTree(tree, "a1", { parentId: "b" }))).toEqual(["a<", "b<", "a1<b", "a2<a1"]);
  });

  it("dá os passos de teclado entre irmãos e níveis", () => {
    expect(treeStep(tree, "b", "up")).toEqual({ parentId: null, beforeId: "a" });
    expect(treeStep(tree, "a", "up")).toBeNull();
    expect(treeStep(tree, "b", "in")).toEqual({ parentId: "a" });
    expect(treeStep(tree, "a1", "in")).toBeNull();
    expect(treeStep(tree, "a2", "out")).toEqual({ parentId: "a", afterId: "a1" });
    expect(treeStep(tree, "a", "out")).toBeNull();
  });

  it("mostra o novo projeto principal junto com a ordem prevista", async () => {
    register("nav", nav);
    const response = Promise.withResolvers<string[]>();
    const moving = moveInOrder("projects", ["a", "c", "b"], () => response.promise, { id: "c", parentId: "a" });
    expect(getQueryData<Navigation>("nav")?.projects.map(({ id, parentId }) => [id, parentId ?? null]))
      .toEqual([["a", null], ["c", "a"], ["b", null]]);
    response.reject(new Error("offline"));
    await expect(moving).rejects.toThrow("offline");
    expect(getQueryData<Navigation>("nav")?.projects.find(({ id }) => id === "c")?.parentId).toBeUndefined();
  });
});

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { applySavedProject, restyleProject } from "@feito/ui/client/project-mutations";
import { clearCache, getQueryData, setQueryData, useQuery } from "@feito/ui/client/store";
import type { Navigation, ProjectPage, ProjectSummary } from "@feito/core/types";

// Dados sintéticos: as respostas do servidor são controladas pelo teste.
const summary = {
  id: "project", revision: 1, name: "Projeto", color: null, icon: "hash",
} as ProjectSummary;

function query<T>(key: string, value: T) {
  function Register() {
    useQuery(key, () => Promise.resolve(value));
    return null;
  }
  renderToString(createElement(Register));
  setQueryData<T>(key, () => value);
  return () => getQueryData<T>(key)!;
}

function fixtures() {
  const page = query<ProjectPage>("project:project", { project: summary } as unknown as ProjectPage);
  const nav = query<Navigation>("nav", { projects: [summary] } as Navigation);
  const style = (project: { icon: string; color: string | null }) => [project.icon, project.color];
  return { title: () => style(page().project), sidebar: () => style(nav().projects[0]) };
}

function delayedWrite(saved: Partial<ProjectSummary>) {
  let resolve!: () => void;
  let reject!: () => void;
  const response = new Promise<void>((done, fail) => { resolve = done; reject = () => fail(new Error("falha")); });
  return {
    send: async () => {
      await response;
      applySavedProject({ ...summary, ...saved });
    },
    resolve, reject,
  };
}

afterEach(() => clearCache());

describe("ícone e cor do projeto", () => {
  it("mostra a escolha no título e na navegação antes da resposta e mantém a cópia do servidor", async () => {
    const state = fixtures();
    const write = delayedWrite({ revision: 2, icon: "star" });
    const done = restyleProject("project", { icon: "star" }, write.send);
    expect(state.title()).toEqual(["star", null]);
    expect(state.sidebar()).toEqual(["star", null]);
    write.resolve();
    await done;
    expect(state.title()).toEqual(["star", null]);
    expect(state.sidebar()).toEqual(["star", null]);
  });

  it("desfaz só a escolha que falhou", async () => {
    const state = fixtures();
    const icon = delayedWrite({ revision: 2, icon: "star" });
    const color = delayedWrite({ revision: 2, color: "azul" });
    const first = restyleProject("project", { icon: "star" }, icon.send);
    const second = restyleProject("project", { color: "azul" }, color.send);
    expect(state.title()).toEqual(["star", "azul"]);
    icon.reject();
    await expect(first).rejects.toThrow("falha");
    expect(state.title()).toEqual(["hash", "azul"]);
    expect(state.sidebar()).toEqual(["hash", "azul"]);
    color.resolve();
    await second;
    expect(state.title()).toEqual(["hash", "azul"]);
    expect(state.sidebar()).toEqual(["hash", "azul"]);
  });

  it("não volta atrás de uma revisão mais nova", () => {
    const state = fixtures();
    applySavedProject({ ...summary, revision: 3, icon: "flag" });
    applySavedProject({ ...summary, revision: 2, icon: "star" });
    expect(state.title()).toEqual(["flag", null]);
    expect(state.sidebar()).toEqual(["flag", null]);
  });
});

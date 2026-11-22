import { describe, expect, it } from "vitest";
import type { TaskItem } from "@feito/core/types";
import { calendarDrop, calendarOrder, calendarRange, noDateWidthLimits } from "@feito/ui/components/project-calendar";
import { sortSiblings, tableRows } from "@feito/ui/components/project-table";

function task(id: string, extra: Partial<TaskItem> = {}): TaskItem {
  return {
    id, revision: 1, title: id, descriptionExcerpt: null, priority: 4, status: "active", completedAt: null, dueDate: null,
    dueTime: null, overdue: false, recurrence: null, occurrenceId: null, projectId: "p", sectionId: null, parentId: null,
    childIds: [], subtasks: { total: 0, completed: 0 }, labels: [], ...extra,
  };
}

describe("calendário do projeto", () => {
  it("mostra semanas inteiras de domingo a sábado em volta do mês", () => {
    // Novembro de 2026 começa num domingo e cabe em cinco semanas.
    expect(calendarRange("2026-11-22", "month")).toEqual({ start: "2026-11-01", days: 35 });
    // Agosto de 2026 começa num sábado e ocupa seis semanas.
    expect(calendarRange("2026-08-15", "month")).toEqual({ start: "2026-07-26", days: 42 });
    expect(calendarRange("2026-11-25", "week")).toEqual({ start: "2026-11-22", days: 7 });
    expect(calendarRange("2026-12-31", "week")).toEqual({ start: "2026-12-27", days: 7 });
  });

  it("ordena o dia com as tarefas sem horário antes das que têm horário", () => {
    const list = [
      task("tarde", { dueTime: "16:30" }), task("manha", { dueTime: "09:00" }), task("p3", { priority: 3 }),
      task("feita", { priority: 1, status: "completed" }), task("p1", { priority: 1 }),
    ];
    expect([...list].sort(calendarOrder).map(({ id }) => id)).toEqual(["p1", "p3", "feita", "manha", "tarde"]);
  });

  it("calcula a data e o horário gravados por um arraste", () => {
    const dated = { dueDate: "2026-11-22", dueTime: "10:15" };
    // No mês, trocar de dia preserva o horário.
    expect(calendarDrop(dated, { date: "2026-11-24" })).toEqual({ dueDate: "2026-11-24", dueTime: undefined });
    expect(calendarDrop(dated, { date: "2026-11-22" })).toBeNull();
    // Na semana, a hora define o horário; na mesma hora, os minutos ficam.
    expect(calendarDrop(dated, { date: "2026-11-23", time: "14:00" })).toEqual({ dueDate: "2026-11-23", dueTime: "14:00" });
    expect(calendarDrop(dated, { date: "2026-11-23", time: "10:00" })).toEqual({ dueDate: "2026-11-23", dueTime: "10:15" });
    expect(calendarDrop(dated, { date: "2026-11-22", time: "10:00" })).toBeNull();
    expect(calendarDrop(dated, { date: "2026-11-22", time: null })).toEqual({ dueDate: "2026-11-22", dueTime: null });
    // O painel Sem data tira a data e o horário.
    expect(calendarDrop(dated, { date: null })).toEqual({ dueDate: null, dueTime: null });
    expect(calendarDrop({ dueDate: null, dueTime: null }, { date: null })).toBeNull();
    expect(calendarDrop({ dueDate: null, dueTime: null }, { date: "2026-11-30" })).toEqual({ dueDate: "2026-11-30", dueTime: undefined });
  });

  it("limita a largura do painel Sem data e deixa espaço para a grade", () => {
    expect(noDateWidthLimits(1400)).toEqual({ min: 220, max: 560 });
    expect(noDateWidthLimits(800)).toEqual({ min: 220, max: 440 });
    // Numa tela estreita, o máximo nunca fica abaixo do mínimo.
    expect(noDateWidthLimits(400)).toEqual({ min: 220, max: 220 });
  });
});

describe("tabela do projeto", () => {
  const list = [
    task("b", { title: "banana", priority: 2, dueDate: "2026-11-25" }),
    task("a", { title: "Abacate", priority: 3 }),
    task("c", { title: "caju", priority: 1, dueDate: "2026-11-23", dueTime: "09:00" }),
    task("d", { title: "damasco", priority: 4, dueDate: "2026-11-23" }),
  ];
  const ids = (tasks: TaskItem[]) => tasks.map(({ id }) => id);

  it("mantém a ordem da resposta sem ordenação de coluna", () => {
    expect(ids(sortSiblings(list, null))).toEqual(["b", "a", "c", "d"]);
  });

  it("ordena por título, prioridade e data, com Sem data no fim nos dois sentidos", () => {
    expect(ids(sortSiblings(list, { key: "title", dir: "asc" }))).toEqual(["a", "b", "c", "d"]);
    expect(ids(sortSiblings(list, { key: "priority", dir: "asc" }))).toEqual(["c", "b", "a", "d"]);
    expect(ids(sortSiblings(list, { key: "date", dir: "asc" }))).toEqual(["c", "d", "b", "a"]);
    expect(ids(sortSiblings(list, { key: "date", dir: "desc" }))).toEqual(["b", "d", "c", "a"]);
  });

  it("mantém cada subtarefa logo abaixo da tarefa-mãe ao ordenar", () => {
    const parent = task("pai", { title: "Zebra", childIds: ["f2", "f1"] });
    const tasks = new Map([
      parent, task("outra", { title: "Abelha" }),
      task("f1", { title: "a filha", parentId: "pai" }), task("f2", { title: "b filha", parentId: "pai" }),
    ].map((item) => [item.id, item]));
    const roots = [parent, tasks.get("outra")!];
    expect(tableRows(roots, tasks, null).map(({ task, depth }) => `${task.id}:${depth}`)).toEqual(["pai:0", "f2:1", "f1:1", "outra:0"]);
    expect(tableRows(roots, tasks, { key: "title", dir: "asc" }).map(({ task }) => task.id)).toEqual(["outra", "pai", "f1", "f2"]);
  });
});

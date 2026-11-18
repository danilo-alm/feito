import { describe, expect, it } from "vitest";
import { applyStep, keyboardPlan, menuActions, resolveDrop } from "@/client/tree";
import type { ProjectPage, SortMode, TaskItem } from "@/client/types";

function task(id: string, sectionId: string | null, fields: Partial<TaskItem> = {}): TaskItem {
  return {
    id, revision: 1, title: id.toUpperCase(), descriptionExcerpt: null, priority: 4, status: "active",
    completedAt: null, dueDate: null, dueTime: null, overdue: false, recurrence: null, occurrenceId: null,
    projectId: "p", sectionId, parentId: null, childIds: [], subtasks: { total: 0, completed: 0 }, labels: [],
    ...fields,
  };
}

// Planejar: a, c (com filho d), e · Comprar: f, g · Sem seção: s
function fixture(sortMode: SortMode = "manual"): ProjectPage {
  return {
    referenceDate: "2026-11-17",
    project: {
      id: "p", revision: 1, name: "Casa nova", isInbox: false, status: "active", activeCount: 7,
      view: { layout: "list", sortMode, showCompleted: false },
    },
    sections: [{ id: "plan", revision: 1, name: "Planejar", taskCount: 4 }, { id: "buy", revision: 1, name: "Comprar", taskCount: 2 }],
    groups: [
      { sectionId: null, rootIds: ["s"] },
      { sectionId: "plan", rootIds: ["a", "c", "e"] },
      { sectionId: "buy", rootIds: ["f", "g"] },
    ],
    tasks: [
      task("s", null),
      task("a", "plan"),
      task("c", "plan", { childIds: ["d"], subtasks: { total: 1, completed: 0 } }),
      task("d", "plan", { parentId: "c" }),
      task("e", "plan"),
      task("f", "buy"),
      task("g", "buy"),
    ],
  };
}

describe("resolveDrop", () => {
  it("reorders between roots with an insertion line", () => {
    const plan = resolveDrop(fixture(), "e", { kind: "task", id: "a", zone: "after" }, "list");
    expect(plan).toMatchObject({
      valid: true,
      steps: [{ type: "position", projectId: "p", sectionId: "plan", parentId: null, afterId: "a" }],
      indicator: { type: "line", id: "a", side: "after", indent: false },
    });
  });

  it("draws the line after the last child when dropping after a parent", () => {
    const plan = resolveDrop(fixture(), "a", { kind: "task", id: "c", zone: "after" }, "list");
    expect(plan?.indicator).toEqual({ type: "line", id: "d", side: "after", indent: false });
  });

  it("ignores drops that keep the same order", () => {
    expect(resolveDrop(fixture(), "c", { kind: "task", id: "a", zone: "after" }, "list")).toBeNull();
    expect(resolveDrop(fixture(), "a", { kind: "task", id: "a", zone: "center" }, "list")).toBeNull();
  });

  it("creates a subtask on the center of a root and previews it after the block", () => {
    const plan = resolveDrop(fixture(), "e", { kind: "task", id: "c", zone: "center" }, "list");
    expect(plan).toMatchObject({
      valid: true,
      steps: [{ type: "position", sectionId: "plan", parentId: "c" }],
      indicator: { type: "nest", id: "c", previewAfterId: "d" },
    });
  });

  it("rejects a third level, parents with children and recurring tasks", () => {
    expect(resolveDrop(fixture(), "e", { kind: "task", id: "d", zone: "center" }, "list"))
      .toMatchObject({ valid: false, message: "Só um nível de subtarefa" });
    expect(resolveDrop(fixture(), "c", { kind: "task", id: "a", zone: "center" }, "list"))
      .toMatchObject({ valid: false, message: "Esta tarefa já tem subtarefas" });
    const page = fixture();
    page.tasks.find((item) => item.id === "a")!.recurrence = { frequency: "daily" };
    expect(resolveDrop(page, "e", { kind: "task", id: "a", zone: "center" }, "list"))
      .toMatchObject({ valid: false, message: "Tarefa recorrente não recebe subtarefas" });
  });

  it("moves a root to another column at the end", () => {
    const plan = resolveDrop(fixture(), "a", { kind: "group", sectionId: "buy" }, "board");
    expect(plan).toMatchObject({
      valid: true,
      steps: [{ type: "position", sectionId: "buy", parentId: null }],
      indicator: { type: "group", sectionId: "buy" },
      message: "Movida para Comprar",
    });
    expect((plan as { steps: object[] }).steps[0]).not.toHaveProperty("afterId");
  });

  it("promotes a subtask before placing it among roots of the same section", () => {
    const plan = resolveDrop(fixture(), "d", { kind: "task", id: "a", zone: "before" }, "list");
    expect(plan).toMatchObject({
      valid: true,
      steps: [{ type: "promote" }, { type: "position", sectionId: "plan", parentId: null, beforeId: "a" }],
    });
  });

  it("requires promotion before a subtask changes section", () => {
    expect(resolveDrop(fixture(), "d", { kind: "task", id: "f", zone: "before" }, "list"))
      .toMatchObject({ valid: false, message: "Promova a subtarefa antes" });
    expect(resolveDrop(fixture(), "d", { kind: "group", sectionId: "buy" }, "board"))
      .toMatchObject({ valid: false });
  });

  it("disables positional reordering in automatic sort but keeps column changes and nesting", () => {
    const page = fixture("date");
    expect(resolveDrop(page, "e", { kind: "task", id: "a", zone: "before" }, "list")).toBeNull();
    expect(resolveDrop(page, "a", { kind: "task", id: "f", zone: "before" }, "board"))
      .toMatchObject({ valid: true, steps: [{ type: "position", sectionId: "buy", parentId: null }] });
    expect(resolveDrop(page, "e", { kind: "task", id: "a", zone: "center" }, "board")).toMatchObject({ valid: true });
  });

  it("refuses to move completed tasks", () => {
    const page = fixture();
    page.tasks.find((item) => item.id === "a")!.status = "completed";
    expect(resolveDrop(page, "a", { kind: "group", sectionId: "buy" }, "board")).toMatchObject({ valid: false });
  });
});

describe("keyboardPlan and menuActions", () => {
  it("moves up and down among active siblings", () => {
    expect(keyboardPlan(fixture(), "c", "up")).toMatchObject({ steps: [{ beforeId: "a", parentId: null }] });
    expect(keyboardPlan(fixture(), "c", "down")).toMatchObject({ steps: [{ afterId: "e" }] });
    expect(keyboardPlan(fixture(), "a", "up")).toBeNull();
  });

  it("nests under the previous root and promotes back", () => {
    expect(keyboardPlan(fixture(), "e", "nest")).toMatchObject({ steps: [{ parentId: "c" }] });
    expect(keyboardPlan(fixture(), "d", "promote")).toMatchObject({ steps: [{ type: "promote" }] });
    expect(keyboardPlan(fixture(), "a", "nest")).toMatchObject({ valid: false });
  });

  it("moves between adjacent columns", () => {
    expect(keyboardPlan(fixture(), "a", "right")).toMatchObject({ steps: [{ sectionId: "buy" }] });
    expect(keyboardPlan(fixture(), "a", "left")).toMatchObject({ steps: [{ sectionId: null }] });
    expect(keyboardPlan(fixture(), "f", "right")).toBeNull();
  });

  it("blocks reordering in automatic sort", () => {
    expect(keyboardPlan(fixture("priority"), "c", "up")).toMatchObject({ valid: false });
    expect(menuActions(fixture("priority"), "e").map(({ action }) => action)).toEqual(["nest"]);
    expect(menuActions(fixture(), "e").map(({ action }) => action)).toEqual(["up", "nest"]);
  });
});

describe("applyStep", () => {
  it("reorders roots and keeps children with their parent", () => {
    const page = applyStep(fixture(), "c", { type: "position", projectId: "p", sectionId: "buy", parentId: null, beforeId: "g" });
    expect(page.groups.find((group) => group.sectionId === "plan")!.rootIds).toEqual(["a", "e"]);
    expect(page.groups.find((group) => group.sectionId === "buy")!.rootIds).toEqual(["f", "c", "g"]);
    expect(page.tasks.find((item) => item.id === "d")!.sectionId).toBe("buy");
  });

  it("nests and promotes", () => {
    const nested = applyStep(fixture(), "e", { type: "position", projectId: "p", sectionId: "plan", parentId: "a" });
    expect(nested.tasks.find((item) => item.id === "a")!.childIds).toEqual(["e"]);
    expect(nested.groups.find((group) => group.sectionId === "plan")!.rootIds).toEqual(["a", "c"]);
    const promoted = applyStep(nested, "e", { type: "promote" });
    expect(promoted.groups.find((group) => group.sectionId === "plan")!.rootIds).toEqual(["a", "e", "c"]);
    expect(promoted.tasks.find((item) => item.id === "e")!.parentId).toBeNull();
  });

  it("removes tasks moved to another project", () => {
    const page = applyStep(fixture(), "c", { type: "position", projectId: "other", sectionId: null, parentId: null });
    expect(page.tasks.map((item) => item.id)).not.toContain("d");
    expect(page.groups.find((group) => group.sectionId === "plan")!.rootIds).toEqual(["a", "e"]);
  });
});

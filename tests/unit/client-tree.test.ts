import { describe, expect, it } from "vitest";
import { applyStep, keyboardPlan, maxOverviewDepth, menuActions, resolveDrop, taskBranch, taskMap } from "@/client/tree";
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
      id: "p", revision: 1, name: "Casa nova", description: "", color: null, icon: "hash", isInbox: false, status: "active", activeCount: 7,
      defaultSectionName: null,
      view: { layout: "list", sortMode, showCompleted: false },
    },
    sections: [
      { id: "plan", revision: 1, name: "Planejar", description: "", taskCount: 4 },
      { id: "buy", revision: 1, name: "Comprar", description: "", taskCount: 2 },
    ],
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
  it("uses the saved name of the default section when moving a task there", () => {
    const page = fixture();
    page.project.defaultSectionName = "Entrada";
    const plan = resolveDrop(page, "e", { kind: "group", sectionId: null }, "board");
    expect(plan).toMatchObject({
      valid: true,
      steps: [{ type: "position", projectId: "p", sectionId: null, parentId: null }],
      message: "Movida para Entrada",
    });
  });

  it("reorders between roots with an insertion line", () => {
    const plan = resolveDrop(fixture(), "e", { kind: "task", id: "a", zone: "after" }, "list");
    expect(plan).toMatchObject({
      valid: true,
      steps: [{ type: "position", projectId: "p", sectionId: "plan", parentId: null, afterId: "a" }],
      indicator: { type: "line", id: "a", side: "after", depth: 0 },
    });
  });

  it("draws the line after the last child when dropping after a parent", () => {
    const plan = resolveDrop(fixture(), "a", { kind: "task", id: "c", zone: "after" }, "list");
    expect(plan?.indicator).toEqual({ type: "line", id: "d", side: "after", depth: 0 });
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

  it("nests entire branches at deeper levels and rejects cycles and recurring tasks", () => {
    expect(resolveDrop(fixture(), "e", { kind: "task", id: "d", zone: "center" }, "list"))
      .toMatchObject({ valid: true, steps: [{ parentId: "d" }], indicator: { depth: 2 } });
    expect(resolveDrop(fixture(), "c", { kind: "task", id: "a", zone: "center" }, "list"))
      .toMatchObject({ valid: true, steps: [{ parentId: "a" }] });
    const nested = applyStep(fixture(), "e", { type: "position", projectId: "p", sectionId: "plan", parentId: "d" });
    expect(resolveDrop(nested, "c", { kind: "task", id: "e", zone: "center" }, "list"))
      .toMatchObject({ valid: false, message: "Uma tarefa não pode ficar abaixo de suas subtarefas" });
    expect(resolveDrop(nested, "a", { kind: "task", id: "c", zone: "after" }, "list"))
      .toMatchObject({ indicator: { type: "line", id: "e", depth: 0 } });
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

  it("places a subtask among the roots of the same section in one step", () => {
    const plan = resolveDrop(fixture(), "d", { kind: "task", id: "a", zone: "before" }, "list");
    expect(plan).toMatchObject({
      valid: true,
      steps: [{ type: "position", sectionId: "plan", parentId: null, beforeId: "a" }],
    });
  });

  it.each(["list", "board"] as const)("moves a subtask as a root into another section in %s", (layout) => {
    const page = fixture();
    const plan = resolveDrop(page, "d", { kind: "task", id: "f", zone: "before" }, layout);
    expect(plan).toMatchObject({
      valid: true,
      steps: [{ type: "position", sectionId: "buy", parentId: null, beforeId: "f" }],
      indicator: { type: "line", id: "f", side: "before", depth: 0 },
    });
    if (!plan?.valid) throw new Error("Expected a valid move");
    const moved = applyStep(page, "d", plan.steps[0]);
    expect(moved.groups.find((group) => group.sectionId === "buy")?.rootIds).toEqual(["d", "f", "g"]);
    expect(moved.tasks.find((item) => item.id === "d")).toMatchObject({ sectionId: "buy", parentId: null });
    expect(moved.tasks.find((item) => item.id === "c")).toMatchObject({ sectionId: "plan", childIds: [], subtasks: { total: 0 } });

    for (const over of [{ kind: "group", sectionId: "buy" }, { kind: "task", id: "f", zone: "center" }] as const) {
      expect(resolveDrop(page, "d", over, layout)).toMatchObject({
        valid: true,
        steps: [{ type: "position", sectionId: "buy", parentId: null }],
        indicator: { type: "group", sectionId: "buy" },
      });
    }
  });

  it("disables positional reordering in automatic sort but keeps column changes and nesting", () => {
    const page = fixture("date");
    expect(resolveDrop(page, "e", { kind: "task", id: "a", zone: "before" }, "list")).toBeNull();
    expect(resolveDrop(page, "a", { kind: "task", id: "f", zone: "before" }, "board"))
      .toMatchObject({ valid: true, steps: [{ type: "position", sectionId: "buy", parentId: null }] });
    expect(resolveDrop(page, "d", { kind: "task", id: "f", zone: "before" }, "board"))
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

  it("indents among nested siblings and promotes just one level", () => {
    const sameParent = applyStep(fixture(), "e", { type: "position", projectId: "p", sectionId: "plan", parentId: "c" });
    const plan = keyboardPlan(sameParent, "e", "nest");
    expect(plan?.valid).toBe(true);
    if (!plan?.valid) throw new Error("Expected a valid move");
    const nested = applyStep(sameParent, "e", plan.steps[0]);
    expect(taskMap(nested).get("e")?.parentId).toBe("d");
    const promoted = applyStep(nested, "e", { type: "promote" });
    expect(taskMap(promoted).get("c")?.childIds).toEqual(["d", "e"]);
    expect(taskMap(promoted).get("e")?.parentId).toBe("c");
  });

  it("moves between adjacent columns", () => {
    expect(keyboardPlan(fixture(), "a", "right")).toMatchObject({ steps: [{ sectionId: "buy" }] });
    expect(keyboardPlan(fixture(), "d", "right")).toMatchObject({ steps: [{ sectionId: "buy", parentId: null }] });
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

  it("caps only the overview and moves the full branch optimistically", () => {
    let page = fixture();
    const chain = Array.from({ length: 9 }, (_, depth) => {
      const id = `nested-${depth}`;
      return task(id, "plan", {
        parentId: depth ? `nested-${depth - 1}` : null,
        childIds: depth < 8 ? [`nested-${depth + 1}`] : [],
      });
    });
    page.tasks.push(...chain);
    page.groups[1].rootIds.push(chain[0].id);
    const tasks = taskMap(page);
    expect(Array.from(taskBranch(chain[0], tasks, maxOverviewDepth), ({ task }) => task.id))
      .toEqual(chain.slice(0, 6).map(({ id }) => id));
    expect(resolveDrop(page, "a", { kind: "task", id: chain[0].id, zone: "after" }, "list"))
      .toMatchObject({ indicator: { id: chain[5].id } });
    expect(resolveDrop(page, "a", { kind: "task", id: chain[5].id, zone: "center" }, "list"))
      .toMatchObject({ valid: true, indicator: { id: chain[5].id, depth: 6 } });
    page = applyStep(page, chain[0].id, { type: "position", projectId: "p", sectionId: "buy", parentId: null });
    expect(taskMap(page).get(chain[8].id)?.sectionId).toBe("buy");
    const moved = applyStep(page, chain[0].id, { type: "position", projectId: "other", sectionId: null, parentId: null });
    expect(taskMap(moved).has(chain[8].id)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { TaskDraft } from "@feito/ui/client/task-mutations";
import { applyTaskChanges } from "@feito/ui/client/task-projections";
import {
  groupPlan, keyboardPlan, maxOverviewDepth, menuActions, originSlot, resolveSlot, slotRows, taskBranch, taskMap,
} from "@feito/ui/client/tree";
import type { MoveTarget, ProjectPage, SortMode, TaskItem } from "@feito/core/types";

function task(id: string, sectionId: string | null, fields: Partial<TaskItem> = {}): TaskItem {
  return {
    id, revision: 1, title: id.toUpperCase(), descriptionExcerpt: null, priority: 4, status: "active",
    completedAt: null, dueDate: null, dueTime: null, overdue: false, recurrence: null, occurrenceId: null,
    projectId: "p", sectionId, parentId: null, childIds: [], subtasks: { total: 0, completed: 0 }, labels: [],
    ...fields,
  };
}

function applyStep(page: ProjectPage, id: string, target: MoveTarget) {
  const key = `project:${page.project.id}`;
  const data = new Map<string, unknown>([[key, page]]);
  const draft = new TaskDraft(data, { inboxId: page.project.id, reference: page.referenceDate });
  draft.move(id, target);
  applyTaskChanges(data, draft.changes());
  return data.get(key) as ProjectPage;
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

describe("groupPlan", () => {
  it("uses the saved name of the default section when moving a task there", () => {
    const page = fixture();
    page.project.defaultSectionName = "Entrada";
    expect(groupPlan(page, "e", null)).toMatchObject({
      valid: true,
      steps: [{ type: "position", projectId: "p", sectionId: null, parentId: null }],
      message: "Moved to Entrada",
    });
  });

  it("moves a root to the end of another column", () => {
    const plan = groupPlan(fixture(), "a", "buy");
    expect(plan).toMatchObject({
      valid: true,
      steps: [{ type: "position", sectionId: "buy", parentId: null }],
      indicator: { type: "group", sectionId: "buy" },
      message: "Moved to Comprar",
    });
    expect((plan as { steps: object[] }).steps[0]).not.toHaveProperty("afterId");
  });

  it("refuses to move completed tasks", () => {
    const page = fixture();
    page.tasks.find((item) => item.id === "a")!.status = "completed";
    expect(groupPlan(page, "a", "buy")).toMatchObject({ valid: false });
    expect(resolveSlot(page, "a", "buy", 0, 0)?.plan).toMatchObject({ valid: false });
  });
});

// Linhas visíveis de Planejar: a (0), c (0), d (1), e (0).
describe("drop slots", () => {
  it("lists the visible rows of a section without the dragged branch", () => {
    expect(slotRows(fixture(), "plan", "e")).toEqual([{ id: "a", depth: 0 }, { id: "c", depth: 0 }, { id: "d", depth: 1 }]);
    expect(slotRows(fixture(), "plan", "c")).toEqual([{ id: "a", depth: 0 }, { id: "e", depth: 0 }]);
  });

  it("opens the space at the origin when the drag starts, without changing anything", () => {
    expect(originSlot(fixture(), "e")).toEqual({ sectionId: "plan", index: 3, depth: 0 });
    expect(originSlot(fixture(), "d")).toEqual({ sectionId: "plan", index: 2, depth: 1 });
    expect(originSlot(fixture(), "a")).toEqual({ sectionId: "plan", index: 0, depth: 0 });
    expect(resolveSlot(fixture(), "e", "plan", 3, 0)).toEqual({ slot: { sectionId: "plan", afterId: "d", depth: 0 }, plan: null });
    expect(resolveSlot(fixture(), "d", "plan", 2, 1)).toEqual({ slot: { sectionId: "plan", afterId: "c", depth: 1 }, plan: null });
  });

  it("reorders between roots when dropped without moving sideways", () => {
    expect(resolveSlot(fixture(), "e", "plan", 1, 0)).toMatchObject({
      slot: { sectionId: "plan", afterId: "a", depth: 0 },
      plan: {
        valid: true,
        steps: [{ type: "position", projectId: "p", sectionId: "plan", parentId: null, afterId: "a" }],
        message: "New position saved in Planejar",
      },
    });
    // Abaixo de uma tarefa com subtarefas, no nível dela: depois do ramo inteiro.
    expect(resolveSlot(fixture(), "e", "plan", 3, -2)?.plan).toBeNull();
  });

  it("nests under the row above when dragged to the right", () => {
    expect(resolveSlot(fixture(), "e", "plan", 1, 1)).toMatchObject({
      slot: { afterId: "a", depth: 1 },
      plan: { valid: true, steps: [{ type: "position", sectionId: "plan", parentId: "a" }], message: "“E” is now a subtask of “A”" },
    });
    // O nível fica limitado a um abaixo da linha de cima: depois de d (nível 1), no máximo subtarefa de d.
    expect(resolveSlot(fixture(), "e", "plan", 3, 5)).toMatchObject({
      slot: { afterId: "d", depth: 2 }, plan: { valid: true, steps: [{ parentId: "d" }] },
    });
    // Entre c e sua primeira subtarefa, o nível mínimo é o de d: entra antes dela, sob c.
    expect(resolveSlot(fixture(), "a", "plan", 1, 0)).toMatchObject({
      slot: { afterId: "c", depth: 1 }, plan: { valid: true, steps: [{ parentId: "c", beforeId: "d" }] },
    });
  });

  it("promotes a subtask dragged to the left and keeps subtasks out of other sections' trees", () => {
    expect(resolveSlot(fixture(), "d", "plan", 0, 1)).toMatchObject({
      slot: { afterId: null, depth: 0 },
      plan: { valid: true, steps: [{ type: "position", sectionId: "plan", parentId: null, beforeId: "a" }] },
    });
    // Em outra seção, a subtarefa só entra como tarefa principal, mesmo arrastada para a direita.
    for (const layout of ["list", "board"] as const) {
      const page = fixture();
      page.project.view.layout = layout;
      const result = resolveSlot(page, "d", "buy", 1, 1);
      expect(result).toMatchObject({
        slot: { sectionId: "buy", afterId: "f", depth: 0 },
        plan: { valid: true, steps: [{ type: "position", sectionId: "buy", parentId: null, afterId: "f" }], message: "Moved to Comprar" },
      });
      if (!result?.plan?.valid) throw new Error("Expected a valid move");
      const moved = applyStep(page, "d", result.plan.steps[0]);
      expect(moved.groups.find((group) => group.sectionId === "buy")?.rootIds).toEqual(["f", "d", "g"]);
      expect(moved.tasks.find((item) => item.id === "c")).toMatchObject({ childIds: [], subtasks: { total: 0 } });
    }
  });

  it("falls back to an allowed level for recurring tasks and refuses when none fits", () => {
    const parent = fixture();
    parent.tasks.find((item) => item.id === "a")!.recurrence = { frequency: "daily" };
    expect(resolveSlot(parent, "e", "plan", 1, 1)).toMatchObject({
      slot: { afterId: "a", depth: 0 }, plan: { valid: true, steps: [{ parentId: null, afterId: "a" }] },
    });
    const recurring = fixture();
    recurring.tasks.find((item) => item.id === "e")!.recurrence = { frequency: "daily" };
    expect(resolveSlot(recurring, "e", "plan", 1, 1)?.slot.depth).toBe(0);
    expect(resolveSlot(recurring, "e", "plan", 2, 0)).toMatchObject({
      slot: { afterId: "c", depth: 1 }, plan: { valid: false, message: "Recurring tasks cannot become subtasks" },
    });
  });

  it("keeps the automatic order: only the column or the parent changes", () => {
    const page = fixture("date");
    expect(resolveSlot(page, "e", "plan", 1, 0)).toEqual({ slot: { sectionId: "plan", afterId: "d", depth: 0 }, plan: null });
    expect(resolveSlot(page, "a", "buy", 0, 0)).toMatchObject({
      slot: { sectionId: "plan", afterId: null, depth: 0 },
      plan: { valid: true, steps: [{ type: "position", sectionId: "buy", parentId: null }], indicator: { type: "group", sectionId: "buy" } },
    });
    expect(resolveSlot(page, "d", "buy", 1, 1)?.plan).toMatchObject({ valid: true, steps: [{ sectionId: "buy", parentId: null }] });
    expect(resolveSlot(page, "e", "plan", 1, 1)?.plan).toMatchObject({ valid: true, steps: [{ parentId: "a" }] });
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

describe("optimistic movement", () => {
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
    // Linhas sem a: c, d, e e o ramo até o nível 5; o espaço depois da última não passa do nível visível.
    expect(slotRows(page, "plan", "a")).toHaveLength(9);
    expect(resolveSlot(page, "a", "plan", 9, 0)?.plan).toMatchObject({ steps: [{ parentId: null, afterId: chain[0].id }] });
    expect(resolveSlot(page, "a", "plan", 9, 9)).toMatchObject({
      slot: { afterId: chain[5].id, depth: maxOverviewDepth },
      plan: { valid: true, steps: [{ parentId: chain[4].id, afterId: chain[5].id }] },
    });
    page = applyStep(page, chain[0].id, { type: "position", projectId: "p", sectionId: "buy", parentId: null });
    expect(taskMap(page).get(chain[8].id)?.sectionId).toBe("buy");
    const moved = applyStep(page, chain[0].id, { type: "position", projectId: "other", sectionId: null, parentId: null });
    expect(taskMap(moved).has(chain[8].id)).toBe(false);
  });
});

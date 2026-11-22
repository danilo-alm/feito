import type { Workspace } from "@feito/core/product/local-workspace";
import type { Replica } from "@feito/core/product/replica";
import { accountReplica } from "../../src/browser/storage";
import { createBrowserStorage } from "./legacy-storage";

const timestamp = "2026-11-22T00:00:00Z";
const storage = createBrowserStorage();

export async function seedAndEdit(size: number) {
  const tasks: Workspace["tasks"] = Array.from({ length: size }, (_, index) => {
    const id = String(index + 1);
    return {
      id, projectId: String((index + 1) % 100), sectionId: null, parentId: null,
      occurrenceId: null, revision: 1, data: {
        title: "Task " + id, description: "", priority: 4, position: index, createdAt: timestamp,
        dueDate: null, dueTime: null, completedAt: null, recurrenceRule: null,
      },
    };
  });
  const projects: Workspace["projects"] = Array.from({ length: 100 }, (_, index) => ({
    id: String(index), revision: 1, isInbox: index === 0,
    data: {
      name: "Project " + index, archived: false, description: "", color: null, icon: "hash",
      createdAt: timestamp, view: { layout: "list", sortMode: "manual", showCompleted: false },
    },
  }));
  const workspace: Workspace = {
    preferences: { timezone: "UTC", theme: "system" },
    projects, sections: [], tasks, labels: [], taskLabels: [], occurrences: [],
  };
  const user = { id: "legacy", email: "legacy@example.invalid" };
  const selected = {
    epoch: "synthetic", space: { kind: "account" as const, user }, discoverSession: false,
  };
  const replica: Replica = { user, cursor: 500, confirmed: workspace, working: workspace, pending: [] };
  const before = await storage.read();
  if (!await storage.commit(before.generation, { selection: selected, data: replica })) throw new Error("Baseline seed failed");

  const started = performance.now();
  const current = await storage.read();
  const initial = accountReplica(current);
  if (!initial) throw new Error("Baseline account unavailable");
  const title = "First edit";
  const next: Replica = {
    ...initial,
    working: {
      ...initial.working,
      tasks: initial.working.tasks.map((task) => task.id === "1"
        ? { ...task, revision: 2, data: { ...task.data, title } }
        : task),
    },
    pending: [...initial.pending, {
      id: "first", method: "PATCH", path: "/tasks/1", authoredAt: timestamp,
      body: { revision: 1, title },
    }],
  };
  if (!await storage.commit(current.generation, { data: next })) throw new Error("Baseline commit failed");
  const editMs = performance.now() - started;
  return { editMs, serializedRecordBytes: new TextEncoder().encode(JSON.stringify(next)).length };
}

export async function readProject() {
  const started = performance.now();
  const replica = accountReplica(await storage.read());
  if (!replica) throw new Error("Baseline account unavailable");
  const project = replica.working.tasks.filter((task) => task.projectId === "1");
  if (project[0].data.title !== "First edit" || replica.pending[0]?.id !== "first") {
    throw new Error("Baseline edit did not survive reopening");
  }
  return performance.now() - started;
}

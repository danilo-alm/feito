import { walkTaskTree } from "../../domain/task-tree";
import type { RecurrenceRule } from "../../validation/product";

type Frequency = RecurrenceRule["frequency"];

// Plano neutro produzido por qualquer importador externo e gravado de forma aditiva na conta.

export type PlannedTask = {
  title: string;
  description: string;
  priority: 1 | 2 | 3 | 4;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: { frequency: Frequency; anchorDate: string } | null;
  labels: string[];
  children: PlannedTask[];
};

export type PlannedSection = { name: string; tasks: PlannedTask[] };

export type PlannedProject = {
  name: string;
  layout: "list" | "board";
  tasks: PlannedTask[];
  sections: PlannedSection[];
};

export type ImportPlan = { projects: PlannedProject[] };

export type SourceFile = { name: string; content: string };
export type ImportIssue = { path: string; message: string };

export type ImporterContext = {
  /** Data civil de hoje no fuso do perfil, `YYYY-MM-DD`. */
  referenceDate: string;
};

export type ImporterResult = {
  plan: ImportPlan | null;
  errors: ImportIssue[];
  warnings: string[];
};

export type Importer = (files: SourceFile[], context: ImporterContext) => ImporterResult;

/** Junta avisos repetidos em uma frase com a contagem. */
export class WarningCollector {
  private readonly counts = new Map<string, { count: number; render: (count: number) => string }>();

  add(key: string, render: (count: number) => string, amount = 1) {
    const entry = this.counts.get(key);
    if (entry) entry.count += amount;
    else this.counts.set(key, { count: amount, render });
  }

  merge(other: WarningCollector) {
    for (const [key, { count, render }] of other.counts) this.add(key, render, count);
  }

  list() {
    return [...this.counts.values()].map(({ count, render }) => render(count));
  }
}

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function walkTasks(tasks: PlannedTask[], visit: (task: PlannedTask, depth: number) => void) {
  for (const { task, depth } of walkTaskTree(tasks, (task) => task.children)) {
    visit(task, depth);
  }
}

export function projectTasks(project: PlannedProject) {
  return [...project.tasks, ...project.sections.flatMap((section) => section.tasks)];
}

import type { CompletedOccurrence, OccurrenceReference, Product, Project, Task } from "../domain/product";
import type { TaskChanges } from "../types";

export type TaskField = "title" | "description" | "priority" | "schedule" | "placement" | "labels" | "completion";
export type TaskAccess<Access> = Access & { receiveChanges?: (changes: TaskChanges) => void };

export type MutationHistory = {
  recorded: boolean;
  previousCompletion?: CompletedOccurrence;
  completion?: CompletedOccurrence;
  canEditTaskField?: (field: TaskField) => boolean;
  touchedTaskFields?: { id: string; fields: TaskField[] };
};

export type ProductProjection = "navigation" | "projects:active" | "projects:archived" | "labels";
export type ProductCalendar = Pick<Product, "referenceDate" | "timezone">;
export type ProductSummary = Pick<Product, "projects" | "labels"> & {
  projectCounts: Map<string, number>;
  labelCounts: Map<string, number>;
  todayCount: number;
};

export type TaskViewScope = {
  projectId?: string;
  labelId?: string;
  skipTasks?: boolean;
} & (
  | { operation: "today"; includeCompleted?: boolean }
  | { operation: "upcoming"; start?: string }
  | { operation: "search" }
  | { operation: "label"; labelId: string; page: { after: () => string | undefined; limit: number } }
);

export type TaskView = ProductCalendar & {
  candidates: ReadonlyMap<string, Task>;
  contextFor: (results: Task[]) => Promise<Product>;
};

export type ProductPort<Access> = {
  requiresTaskRevision: (access: Access) => boolean;
  allocateId: (access: Access, slot: number) => string;
  mutateProduct<T>(
    access: Access,
    apply: (draft: Product, original: Product, history: MutationHistory, revision: number) => T,
    occurrence?: OccurrenceReference,
    options?: { removeOccurrence?: OccurrenceReference },
  ): Promise<T>;
  readProjectView(access: Access, id: string): Promise<{ product: Product; project: Project }>;
  readTaskDetail(access: Access, id: string): Promise<{ product: Product; task: Task }>;
  readProductSummary<T>(
    access: Access, projection: ProductProjection, select: (summary: ProductSummary, calendar: ProductCalendar | undefined) => T,
  ): Promise<T>;
  readTaskView<T>(access: Access, scope: TaskViewScope, run: (view: TaskView) => Promise<T>): Promise<T>;
};

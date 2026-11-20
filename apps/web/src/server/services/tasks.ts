import "server-only";
import { createTasksService } from "@feito/core/product/tasks";
import type { TaskAccess as WithTaskChanges } from "@feito/core/product/port";
import { mutateProduct, type ProductAccess } from "@/server/db/product";
import { readTaskDetail } from "@/server/db/product-reads";
import { allocateId } from "./product-id";

export type TaskAccess = WithTaskChanges<ProductAccess>;

export const {
  createTask, duplicateTask, getTask, editTask, setRecurrence, removeRecurrence, completeTask, reopenTask,
  undoTaskCompletion, deleteTask, moveTask,
} = createTasksService<ProductAccess>({
  allocateId,
  mutateProduct,
  requiresTaskRevision: (access) => !access.desktopOperation,
  readTaskDetail,
});

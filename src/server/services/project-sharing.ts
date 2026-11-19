import "server-only";
import type { ProductAccess } from "@/server/db/product";
import { readSharedProject } from "@/server/db/project-shares";
import { projectPage } from "./product-dto";

export async function getPublicProject(access: Omit<ProductAccess, "tenantId">, token: string, includeCompleted?: boolean) {
  const { product, project } = await readSharedProject(access, token);
  const page = projectPage(product, project, includeCompleted);
  const { id, name, defaultSectionName, view, activeCount } = page.project;
  return {
    referenceDate: page.referenceDate,
    project: { id, name, defaultSectionName, status: "active" as const, view, activeCount },
    sections: page.sections.map(({ id, name, taskCount }) => ({ id, name, taskCount })),
    groups: page.groups,
    tasks: page.tasks.map((task) => ({
      id: task.id,
      sectionId: task.sectionId,
      parentId: task.parentId,
      title: task.title,
      description: product.tasks.get(task.id)!.data.description,
      descriptionExcerpt: task.descriptionExcerpt,
      status: task.status,
      completedAt: task.completedAt,
      priority: task.priority,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      overdue: task.overdue,
      recurrence: task.recurrence,
      childIds: task.childIds,
      subtasks: task.subtasks,
      labels: task.labels,
    })),
  };
}

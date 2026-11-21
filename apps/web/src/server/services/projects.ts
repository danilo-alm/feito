import "server-only";
import { projectPage } from "@feito/core/product/product-dto";
import { createProjectsService } from "@feito/core/product/projects";
import { readLocalTaskList } from "@/server/db/product-cache";
import { mutateProduct, type ProductAccess } from "@/server/db/product";
import { readProjectView } from "@/server/db/product-reads";
import { readProductSummary } from "@/server/db/product-summary";
import { allocateId } from "./product-id";

export const {
  getNavigation, listProjects, createProject, editProject, updateProjectView, setProjectArchived,
  deleteProject, createSection, editSection, moveSection, deleteSection,
} = createProjectsService<ProductAccess>({
  allocateId,
  mutateProduct,
  readProjectView,
  readProductSummary,
});

export function getProject(access: ProductAccess, id: string, includeCompleted?: boolean) {
  return readLocalTaskList(access, "project", [id, includeCompleted], async () => {
    const { product, project } = await readProjectView(access, id);
    return {
      data: projectPage(product, project, includeCompleted),
      calendar: { timezone: product.timezone, referenceDate: product.referenceDate },
    };
  });
}

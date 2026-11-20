import "server-only";
import { createProjectsService } from "@feito/core/product/projects";
import { mutateProduct, type ProductAccess } from "@/server/db/product";
import { readProjectView } from "@/server/db/product-reads";
import { readProductSummary } from "@/server/db/product-summary";
import { allocateId } from "./product-id";

export const {
  getNavigation, listProjects, getProject, createProject, editProject, updateProjectView, setProjectArchived,
  deleteProject, createSection, editSection, moveSection, deleteSection,
} = createProjectsService<ProductAccess>({
  allocateId,
  mutateProduct,
  readProjectView,
  readProductSummary,
});

import "server-only";
import { createLabelsService } from "@feito/core/product/labels";
import { mutateProduct, type ProductAccess } from "@/server/db/product";
import { readProductSummary } from "@/server/db/product-summary";
import { readTaskView } from "@/server/db/task-views";
import { allocateId } from "./product-id";

export const {
  listLabels, createLabel, renameLabel, deleteLabel, listLabelTasks,
} = createLabelsService<ProductAccess>({
  allocateId,
  mutateProduct,
  readProductSummary,
  readTaskView,
});

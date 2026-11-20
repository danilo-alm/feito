import "server-only";
import { createAgendaService } from "@feito/core/product/agenda";
import type { ProductAccess } from "@/server/db/product";
import { readTaskView } from "@/server/db/task-views";

export const {
  getToday, getUpcoming,
} = createAgendaService<ProductAccess>({
  readTaskView,
});

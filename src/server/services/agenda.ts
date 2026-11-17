import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { collectToday, compareAgenda } from "@/domain/agenda";
import { isActive, type Task } from "@/domain/product";
import type { ProductAccess } from "@/server/db/product";
import { readTaskView } from "@/server/db/task-views";
import { civilDate } from "@/validation/product";
import { taskItemsWithOrigin } from "./product-dto";
import { validation } from "./product-rules";

export function getToday(access: ProductAccess, includeCompleted = false) {
  return readTaskView(access, { operation: "today" }, async (view) => {
    const { referenceDate, timezone } = view;
    const { overdue, today, completedToday } = collectToday(view.candidates.values(), referenceDate, timezone, includeCompleted);
    const product = await view.contextFor([...overdue, ...today, ...completedToday]);
    const items = taskItemsWithOrigin(product);
    return {
      referenceDate,
      timezone,
      overdue: overdue.map(items),
      today: today.map(items),
      ...(includeCompleted ? { completedToday: completedToday.map(items) } : {}),
    };
  });
}

export function getUpcoming(access: ProductAccess, requestedStart?: string) {
  return readTaskView(access, { operation: "upcoming" }, async (view) => {
    const tomorrow = Temporal.PlainDate.from(view.referenceDate).add({ days: 1 }).toString();
    const start = requestedStart ?? tomorrow;
    if (start < tomorrow) throw validation("start", "Informe amanhã ou uma data posterior.");
    const first = Temporal.PlainDate.from(start);
    const dates = Array.from({ length: 7 }, (_, day) => first.add({ days: day }).toString());
    if (!civilDate.safeParse(dates[6]).success) throw validation("start", "O período excede o intervalo disponível.");

    const tasksByDate = new Map(dates.map((date) => [date, [] as Task[]]));
    for (const task of view.candidates.values()) {
      if (isActive(task) && task.data.dueDate) tasksByDate.get(task.data.dueDate)?.push(task);
    }
    const product = await view.contextFor([...tasksByDate.values()].flat());
    const items = taskItemsWithOrigin(product);
    return {
      referenceDate: view.referenceDate,
      start,
      days: [...tasksByDate].map(([date, tasks]) => ({ date, tasks: tasks.sort(compareAgenda).map(items) })),
    };
  });
}

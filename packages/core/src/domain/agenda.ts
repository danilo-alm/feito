import { Temporal } from "@js-temporal/polyfill";
import { isActive, type Task } from "./product";

export function compareAgenda(a: Task, b: Task) {
  return (a.data.dueTime ?? "24:00").localeCompare(b.data.dueTime ?? "24:00")
    || a.data.priority - b.data.priority || a.id.localeCompare(b.id);
}

export function compareOverdue(a: Task, b: Task) {
  return (a.data.dueDate ?? "").localeCompare(b.data.dueDate ?? "") || compareAgenda(a, b);
}

export function compareCompleted(a: Task, b: Task) {
  return Temporal.Instant.compare(b.data.completedAt!, a.data.completedAt!) || a.id.localeCompare(b.id);
}

export function completedOn(task: Task, date: string, timezone: string) {
  return task.data.completedAt !== null
    && Temporal.Instant.from(task.data.completedAt).toZonedDateTimeISO(timezone).toPlainDate().toString() === date;
}

export function collectToday(tasks: Iterable<Task>, date: string, timezone: string, includeCompleted: boolean) {
  const overdue: Task[] = [];
  const today: Task[] = [];
  const completedToday: Task[] = [];
  for (const task of tasks) {
    if (isActive(task)) {
      const { dueDate } = task.data;
      if (dueDate === null) continue;
      if (dueDate < date) overdue.push(task);
      else if (dueDate === date) today.push(task);
    } else if (includeCompleted && completedOn(task, date, timezone)) {
      completedToday.push(task);
    }
  }
  return {
    overdue: overdue.sort(compareOverdue),
    today: today.sort(compareAgenda),
    completedToday: completedToday.sort(compareCompleted),
  };
}

import { isActive, isOverdue, type Task } from "./product";
import type { SearchInput } from "../validation/product";

export function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/\p{Mark}/gu, "").toLowerCase();
}

function matchesDate(task: Task, date: SearchInput["date"], today: string) {
  if (!date) return true;
  const { dueDate } = task.data;
  switch (date.kind) {
    case "today": return dueDate === today;
    case "overdue": return isOverdue(task, today);
    case "none": return dueDate === null;
    case "range": return dueDate !== null && date.from <= dueDate && dueDate <= date.to;
  }
}

export function matchesSearch(
  task: Task, input: Pick<SearchInput, "date" | "priority" | "includeCompleted">, text: string, today: string,
) {
  if (!input.includeCompleted && !isActive(task)) return false;
  if (input.priority !== undefined && task.data.priority !== input.priority) return false;
  if (!matchesDate(task, input.date, today)) return false;
  if (!text) return true;
  return normalizeSearchText(task.data.title).includes(text)
    || normalizeSearchText(task.data.description).includes(text);
}

export function compareSearchKey(a: { completed: boolean; id: string }, b: { completed: boolean; id: string }) {
  return Number(a.completed) - Number(b.completed) || (a.id < b.id ? -1 : Number(a.id > b.id));
}

export function searchKey(task: Task) {
  return { completed: !isActive(task), id: task.id };
}

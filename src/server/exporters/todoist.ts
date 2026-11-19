import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { byPosition, childrenByParent, isActive, orderedSections, type Product, type Project, type Task } from "@/domain/product";
import { walkTaskTree } from "@/domain/task-tree";
import type { Exporter } from "./types";

// Gera o CSV de modelo do Todoist, no mesmo formato da exportação oficial e lido de volta por
// src/server/importers/todoist. Como no Todoist, tarefas concluídas ficam de fora.

const COLUMNS = [
  "TYPE", "CONTENT", "DESCRIPTION", "ICON", "IS_COLLAPSED", "PRIORITY", "INDENT", "AUTHOR", "RESPONSIBLE", "DATE",
  "DATE_LANG", "TIMEZONE", "DURATION", "DURATION_UNIT", "DEADLINE", "DEADLINE_LANG", "REMINDER_TYPE",
  "REMINDER_OFFSET", "REMINDER_DATE", "REMINDER_DATE_LANG",
] as const;
type Column = (typeof COLUMNS)[number];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function cell(value: string) {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function row(values: Partial<Record<Column, string>>) {
  return COLUMNS.map((column) => cell(values[column] ?? "")).join(",");
}

function ordinal(day: number) {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

/** Texto de vencimento em inglês, que o Todoist interpreta com DATE_LANG=en. */
export function dueText(task: Task, today: string, relative: boolean) {
  const { dueDate, dueTime, recurrenceRule } = task.data;
  const at = dueTime ? ` at ${dueTime}` : "";
  if (recurrenceRule) {
    const anchor = Temporal.PlainDate.from(recurrenceRule.anchorDate);
    const every = recurrenceRule.frequency === "daily" ? "every day"
      : recurrenceRule.frequency === "weekly" ? `every ${WEEKDAYS[anchor.dayOfWeek - 1]}`
        : `every ${ordinal(anchor.day)}`;
    return every + at;
  }
  if (!dueDate) return "";
  const date = Temporal.PlainDate.from(dueDate);
  if (relative) {
    const days = Temporal.PlainDate.from(today).until(date, { largestUnit: "days" }).days;
    if (days === 0) return `today${at}`;
    if (days === 1) return `tomorrow${at}`;
    if (days > 1) return `in ${days} days${at}`;
  }
  return `${MONTHS[date.month - 1]} ${date.day} ${date.year}${at}`;
}

/** Etiquetas viram `@nome` no título; espaços viram `_`, pois o Todoist termina a etiqueta no espaço. */
function content(product: Product, task: Task) {
  const labels = (product.taskLabels.get(task.id) ?? [])
    .map((id) => product.labels.get(id)?.data.name)
    .filter((name): name is string => !!name)
    .map((name) => `@${name.replace(/[\s@]+/g, "_")}`);
  return [task.data.title, ...labels].join(" ");
}

export const exportTodoist: Exporter = (product, project, options) => {
  const relative = options.relativeDates === true;
  const tasks = [...product.tasks.values()].filter((task) => task.projectId === project.id && isActive(task));
  const children = childrenByParent(tasks);
  const lines = [row(Object.fromEntries(COLUMNS.map((column) => [column, column]))),
    row({ TYPE: "meta", CONTENT: `view_style=${project.data.view.layout}` })];

  const taskRow = (task: Task, indent: number) => row({
    TYPE: "task", CONTENT: content(product, task), DESCRIPTION: task.data.description,
    PRIORITY: String(task.data.priority), INDENT: String(indent),
    DATE: dueText(task, product.referenceDate, relative),
    DATE_LANG: task.data.dueDate || task.data.recurrenceRule ? "en" : "",
    TIMEZONE: product.timezone,
  });
  const group = (sectionId: string | null) => {
    const roots = tasks.filter((task) => !task.parentId && task.sectionId === sectionId).sort(byPosition);
    for (const { task, depth } of walkTaskTree(roots, (task) => children.get(task.id) ?? [])) {
      lines.push(taskRow(task, depth + 1));
    }
  };

  lines.push(row({}));
  group(null);
  for (const section of orderedSections(product, project.id)) {
    lines.push(row({}), row({ TYPE: "section", CONTENT: section.data.name, IS_COLLAPSED: "False" }));
    group(section.id);
  }
  return {
    fileName: `${project.data.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: `﻿${lines.join("\n")}\n`,
  };
};

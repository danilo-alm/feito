"use client";
import { useState } from "react";
import { errorMessage } from "./api";
import { appendQueryData } from "./store";
import type { TaskItem } from "@feito/core/types";

type CursorPage = { nextCursor: string | null };

/** As páginas adicionais passam pela mesma projeção da primeira página. */
export function useTaskPagination<T extends CursorPage>(
  key: string | null,
  page: T | undefined,
  field: "tasks" | "results",
  fetchPage: (cursor: string) => Promise<CursorPage & { tasks: TaskItem[] }>,
) {
  const [status, setStatus] = useState<{ key: string; loading: boolean; error?: string }>();
  const loading = status?.key === key && status.loading;
  const cursor = page?.nextCursor;
  const loadMore = async () => {
    if (!key || !cursor || loading) return;
    setStatus({ key, loading: true });
    try {
      await appendQueryData<T>(key, async (current) => {
        const next = await fetchPage(cursor);
        const tasks = new Map((current[field as keyof T] as TaskItem[]).map((task) => [task.id, task]));
        for (const task of next.tasks) if (!tasks.has(task.id)) tasks.set(task.id, task);
        return { ...current, [field]: [...tasks.values()], nextCursor: next.nextCursor };
      });
      setStatus({ key, loading: false });
    } catch (error) {
      setStatus({ key, loading: false, error: errorMessage(error) });
    }
  };
  return { tasks: (page?.[field as keyof T] as TaskItem[] | undefined) ?? [], cursor, loading, error: status?.key === key ? status.error : undefined, loadMore };
}

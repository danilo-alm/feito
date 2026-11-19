"use client";
import { useState } from "react";
import { errorMessage } from "./api";
import type { TaskItem } from "./types";

type CursorPage = { nextCursor: string | null };

/** Páginas extras pertencem à primeira resposta que forneceu o cursor. */
export function useTaskPagination(
  first: CursorPage | undefined,
  firstTasks: TaskItem[] | undefined,
  fetchPage: (cursor: string) => Promise<CursorPage & { tasks: TaskItem[] }>,
) {
  const [tail, setTail] = useState<{
    first: CursorPage | undefined;
    tasks: TaskItem[];
    cursor: string | null;
    loading: boolean;
    error: string | null;
  }>(() => ({ first, tasks: [], cursor: first?.nextCursor ?? null, loading: false, error: null }));

  if (tail.first !== first) {
    setTail({ first, tasks: [], cursor: first?.nextCursor ?? null, loading: false, error: null });
  }

  const loadMore = async () => {
    if (!tail.cursor || tail.loading) return;
    const pending = { ...tail, loading: true, error: null };
    setTail(pending);
    try {
      const page = await fetchPage(tail.cursor);
      setTail((current) => current === pending
        ? { ...tail, tasks: [...tail.tasks, ...page.tasks], cursor: page.nextCursor, error: null }
        : current);
    } catch (error) {
      setTail((current) => current === pending ? { ...tail, error: errorMessage(error) } : current);
    }
  };

  const unique = new Map((firstTasks ?? []).map((task) => [task.id, task]));
  for (const task of tail.tasks) if (!unique.has(task.id)) unique.set(task.id, task);
  return { tasks: [...unique.values()], cursor: tail.cursor, loading: tail.loading, error: tail.error, loadMore };
}

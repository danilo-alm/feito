"use client";
import type { ReactNode } from "react";
import type { TaskItem } from "@feito/core/types";
import { useTaskActions } from "./task-actions";
import { TaskRow } from "./task-row";

/** Grupo de tarefas sem hierarquia (agenda, busca, etiqueta), com origem de cada item. */
export function FlatGroup({ title, count, tasks, actions, aside, muted, empty, showOrigin = true, timeOnly }: {
  title?: ReactNode;
  count?: number;
  tasks: TaskItem[];
  actions: ReturnType<typeof useTaskActions>;
  aside?: ReactNode;
  muted?: boolean;
  empty?: ReactNode;
  showOrigin?: boolean;
  timeOnly?: boolean;
}) {
  return (
    <section aria-label={typeof title === "string" ? title : undefined}>
      {title && (
        <div className="sec-h" data-flip={typeof title === "string" ? `group:${title}` : undefined} style={muted ? { color: "var(--text-2)" } : undefined}>
          {title}{count !== undefined && <span className="count">{count}</span>}
          {aside}
        </div>
      )}
      {!tasks.length && empty}
      {tasks.map((task) => <TaskRow key={task.id} task={task} actions={actions} showOrigin={showOrigin} timeOnly={timeOnly} />)}
    </section>
  );
}

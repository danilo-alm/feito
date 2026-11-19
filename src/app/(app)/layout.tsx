"use client";
import { Suspense, useCallback, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell, type TaskSelection } from "@/components/app";
import { MobileChrome, Sidebar } from "@/components/chrome";
import { QuickAdd } from "@/components/quick-add";
import { TaskDetailDialog } from "@/components/task-detail";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      renderChrome={(nav) => <Sidebar nav={nav} />}
      renderOverlays={(state, close) => (
        <>
          <MobileChrome />
          <QuickAdd defaults={state.quickAdd} onClose={() => close("quickAdd")} />
          <Suspense>
            <TaskOverlay task={state.task} close={close} />
          </Suspense>
        </>
      )}
    >
      {children}
    </AppShell>
  );
}

function TaskOverlay({ task, close }: { task: TaskSelection | null; close: (key: "task") => void }) {
  const linkedId = useSearchParams().get("tarefa");
  const onClose = useCallback(() => {
    if (linkedId) {
      const url = new URL(window.location.href);
      url.searchParams.delete("tarefa");
      window.history.replaceState(null, "", url);
    }
    close("task");
  }, [linkedId, close]);
  return <TaskDetailDialog selection={task ?? (linkedId ? { id: linkedId, order: [] } : null)} onClose={onClose} />;
}

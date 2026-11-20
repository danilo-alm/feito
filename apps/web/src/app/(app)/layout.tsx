"use client";
import { Suspense, useCallback, useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { invalidate } from "@feito/ui/client/store";
import { AppShell, type TaskSelection } from "@feito/ui/components/app";
import { MobileChrome, Sidebar } from "@feito/ui/components/chrome";
import { QuickAdd } from "@feito/ui/components/quick-add";
import { TaskDetailDialog } from "@feito/ui/components/task-detail";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    let events: EventSource;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1_000;

    function connect() {
      const stream = new EventSource("/api/v1/product-events");
      events = stream;
      stream.addEventListener("revision", () => {
        delay = 1_000;
        void invalidate(undefined, { retainInactive: true });
      });
      stream.onerror = () => {
        // EventSource retries interrupted streams itself, but can stop after an HTTP error.
        if (stream.readyState !== EventSource.CLOSED) return;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 60_000);
      };
    }

    connect();
    return () => {
      events.close();
      clearTimeout(retry);
    };
  }, []);

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

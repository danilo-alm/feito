"use client";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app";
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
          <TaskDetailDialog taskId={state.taskId} onClose={() => close("taskId")} />
        </>
      )}
    >
      {children}
    </AppShell>
  );
}

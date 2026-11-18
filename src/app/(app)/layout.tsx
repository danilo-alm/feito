"use client";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app";
import { Drawer, MobileChrome, Sidebar } from "@/components/chrome";
import { QuickAdd } from "@/components/quick-add";
import { TaskDetailDialog } from "@/components/task-detail";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      renderChrome={(nav) => <Sidebar nav={nav} />}
      renderOverlays={(state, close) => (
        <>
          <MobileChrome />
          <Drawer nav={undefined} open={state.drawer} onClose={() => close("drawer")} />
          <QuickAdd defaults={state.quickAdd} onClose={() => close("quickAdd")} />
          <TaskDetailDialog taskId={state.taskId} onClose={() => close("taskId")} />
        </>
      )}
    >
      {children}
    </AppShell>
  );
}

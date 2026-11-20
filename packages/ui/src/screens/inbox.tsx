"use client";
import { useApp } from "../components/app";
import { ProjectView } from "../components/project-view";

export default function InboxPage() {
  const app = useApp();
  return <ProjectView projectId={app.nav?.inbox.projectId ?? app.me.inboxProjectId} />;
}

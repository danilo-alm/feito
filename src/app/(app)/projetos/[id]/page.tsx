"use client";
import { use } from "react";
import { ProjectView } from "@/components/project-view";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProjectView key={id} projectId={id} />;
}

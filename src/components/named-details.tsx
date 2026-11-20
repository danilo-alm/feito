"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import type { NamedDetails, ProjectStyle, ProjectSummary } from "@/client/types";
import type { ProjectColor, ProjectIcon } from "@/validation/project-style";
import { ProjectStyleFields } from "./project-style";
import { refreshProjects, useApp } from "./app";
import { Dialog, useAutoGrow } from "./ui";

export function NamedDetailsForm({ kind, initial, submitLabel, onSave, onCancel, inDialog = false, projectId }: {
  kind: "projeto" | "seção";
  initial?: NamedDetails & Partial<ProjectStyle>;
  submitLabel: string;
  onSave: (details: NamedDetails & Partial<ProjectStyle>) => Promise<unknown>;
  projectId?: string;
  onCancel: () => void;
  inDialog?: boolean;
}) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const growDescription = useAutoGrow(description);
  const [color, setColor] = useState<ProjectColor | null>(initial?.color ?? null);
  const [icon, setIcon] = useState<ProjectIcon>(initial?.icon ?? "hash");
  const [saving, setSaving] = useState(false);
  const validName = name.trim();

  return (
    <form className="named-details-form" onSubmit={async (event) => {
      event.preventDefault();
      if (!validName || saving) return;
      setSaving(true);
      try {
        await onSave(kind === "projeto" ? { name: validName, description, color, icon } : { name: validName, description });
      } finally {
        setSaving(false);
      }
    }} onKeyDown={(event) => {
      if (event.key !== "Escape" || inDialog || event.nativeEvent.isComposing) return;
      event.stopPropagation();
      if (!saving) onCancel();
    }}>
      <label htmlFor={`${id}-name`} className="sr-only">{kind === "projeto" ? "Nome do projeto" : "Nome da seção"}</label>
      <input id={`${id}-name`} className="inline-input named-details-name" value={name} maxLength={120}
        autoFocus={!inDialog} data-autofocus disabled={saving} onChange={(event) => setName(event.target.value)}
        placeholder={kind === "projeto" ? "Nome do projeto" : "Nomear esta seção"} />
      <label htmlFor={`${id}-description`} className="sr-only">
        {kind === "projeto" ? "Descrição do projeto" : "Descrição da seção"}
      </label>
      <textarea id={`${id}-description`}
        className={`inline-input named-details-description${kind === "projeto" ? " auto-grow" : ""}`}
        ref={kind === "projeto" ? growDescription : undefined} value={description}
        disabled={saving} onChange={(event) => setDescription(event.target.value)}
        rows={3} maxLength={10_000} placeholder="Adicionar uma descrição" />
      {kind === "projeto" && (
        <ProjectStyleFields projectId={projectId} color={color} icon={icon} disabled={saving} onColor={setColor} onIcon={setIcon} />
      )}
      <div className="named-details-actions">
        <button type="submit" className="btn primary" disabled={!validName || saving}>{submitLabel}</button>
        <button type="button" className="btn ghost" disabled={saving} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

export function useProjectDetailsDialog() {
  const app = useApp();
  const router = useRouter();
  const [target, setTarget] = useState<ProjectSummary | "new" | null>(null);
  const close = () => setTarget(null);
  const project = target === "new" ? undefined : target ?? undefined;

  const dialog = (
    <Dialog open={target !== null} onClose={close} title={project ? "Editar projeto" : "Novo projeto"}>
      {target && <div className="dialog-b">
        <NamedDetailsForm key={project?.id ?? "new"} kind="projeto" initial={project} projectId={project?.id} inDialog
          submitLabel={project ? "Salvar" : "Criar projeto"} onCancel={close} onSave={async (details) => {
            if (project && details.name === project.name && details.description === project.description
              && details.color === project.color && details.icon === project.icon) {
              close();
              return;
            }
            const saved = await app.run(
              () => project ? api.projects.edit(project.id, project.revision, details) : api.projects.create({ ...details, color: details.color ?? null, icon: details.icon ?? "hash" }),
              { success: project ? "Projeto atualizado" : "Projeto criado", revalidate: project ? refreshProjects : (key) => key === "nav" },
            );
            if (!saved) return;
            close();
            if (!project) router.push(`/projetos/${saved.id}`);
          }} />
      </div>}
    </Dialog>
  );
  return { dialog, create: () => setTarget("new"), edit: (project: ProjectSummary) => setTarget(project) };
}

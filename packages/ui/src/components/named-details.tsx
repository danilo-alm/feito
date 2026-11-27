"use client";
import { useT } from "./language";

import { useId, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "../navigation";
import { api } from "../client/api";
import { subtreeIds, treeDepths } from "../client/manual-order";
import { sidewaysScroll } from "../client/sideways-scroll";
import type { NamedDetails, ProjectStyle, ProjectSummary } from "@feito/core/types";
import type { ProjectColor, ProjectIcon } from "@feito/core/validation/project-style";
import { ProjectGlyph, ProjectStyleFields } from "./project-style";
import { refreshProjects, useApp } from "./app";
import { IconCheck, IconChevronDown } from "./icons";
import { Dialog, Popover, useAutoGrow } from "./ui";

type ProjectFields = Partial<ProjectStyle> & { parentId?: string | null };

/** Escolha do projeto principal: nenhum ou outro projeto ativo, fora o próprio e os subprojetos dele. */
function ParentProjectField({ projectId, parentId, disabled, onChange }: {
  projectId?: string; parentId: string | null; disabled?: boolean; onChange: (parentId: string | null) => void;
}) {
  const t = useT();
  const id = useId();
  const { nav } = useApp();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const projects = nav?.projects ?? [];
  const depths = treeDepths(projects);
  const excluded = projectId ? subtreeIds(projects, projectId) : new Set<string>();
  const options = [null, ...projects.filter((project) => !excluded.has(project.id))];
  const current = projects.find((project) => project.id === parentId);
  const close = () => setOpen(false);

  return (
    <div className="ps-field">
      <span className="lbl" id={`${id}-label`}>{t("Projeto principal")}</span>
      <button ref={anchor} type="button" className="inline-input ps-select" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen(!open)}>
        {current && <ProjectGlyph id={current.id} />}
        <span id={`${id}-value`} className="ps-value">{current?.name ?? t("Nenhum")}</span>
        <IconChevronDown className="sm" />
      </button>
      <Popover anchor={anchor.current} open={open} onClose={close} label={t("Projeto principal")} role="listbox" width={280}>
        <div className="ps-list" role="presentation">
          {options.map((option) => {
            const selected = (option?.id ?? null) === (current?.id ?? null);
            return (
              <button key={option?.id ?? "none"} type="button" role="option" aria-selected={selected}
                className={`mi ps-option${selected ? " on" : ""}`} data-autofocus={selected || undefined}
                style={option && depths.get(option.id) ? { "--depth": depths.get(option.id) } as CSSProperties : undefined}
                onClick={() => { onChange(option?.id ?? null); close(); }}>
                <span className="ps-check">{selected && <IconCheck />}</span>
                {option && <ProjectGlyph id={option.id} />}
                <span className="ps-value">{option?.name ?? t("Nenhum")}</span>
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

export function NamedDetailsForm({ kind, initial, submitLabel, onSave, onCancel, inDialog = false, projectId }: {
  kind: "projeto" | "seção";
  initial?: NamedDetails & ProjectFields;
  submitLabel: string;
  onSave: (details: NamedDetails & ProjectFields) => Promise<unknown>;
  projectId?: string;
  onCancel: () => void;
  inDialog?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const growDescription = useAutoGrow(description);
  const [color, setColor] = useState<ProjectColor | null>(initial?.color ?? null);
  const [icon, setIcon] = useState<ProjectIcon>(initial?.icon ?? "hash");
  const [parentId, setParentId] = useState(initial?.parentId ?? null);
  const [saving, setSaving] = useState(false);
  const validName = name.trim();

  return (
    <form className="named-details-form" onSubmit={async (event) => {
      event.preventDefault();
      if (!validName || saving) return;
      setSaving(true);
      try {
        await onSave(kind === "projeto" ? { name: validName, description, color, icon, parentId } : { name: validName, description });
      } finally {
        setSaving(false);
      }
    }} onKeyDown={(event) => {
      if (event.key !== "Escape" || inDialog || event.nativeEvent.isComposing) return;
      event.stopPropagation();
      if (!saving) onCancel();
    }}>
      <label htmlFor={`${id}-name`} className="sr-only">{kind === "projeto" ? t("Nome do projeto") : t("Nome da seção")}</label>
      <input id={`${id}-name`} ref={sidewaysScroll} className="inline-input named-details-name" value={name} maxLength={120}
        autoFocus={!inDialog} data-autofocus disabled={saving} onChange={(event) => setName(event.target.value)}
        placeholder={kind === "projeto" ? t("Nome do projeto") : t("Nomear esta seção")} />
      <label htmlFor={`${id}-description`} className="sr-only">
        {kind === "projeto" ? t("Descrição do projeto") : t("Descrição da seção")}
      </label>
      <textarea id={`${id}-description`}
        className={`inline-input named-details-description${kind === "projeto" ? " auto-grow" : ""}`}
        ref={kind === "projeto" ? growDescription : undefined} value={description}
        disabled={saving} onChange={(event) => setDescription(event.target.value)}
        rows={3} maxLength={10_000} placeholder={t("Adicionar uma descrição")} />
      {kind === "projeto" && (
        <ProjectStyleFields projectId={projectId} color={color} icon={icon} disabled={saving} onColor={setColor} onIcon={setIcon} />
      )}
      {kind === "projeto" && inDialog && (
        <ParentProjectField projectId={projectId} parentId={parentId} disabled={saving} onChange={setParentId} />
      )}
      <div className="named-details-actions">
        <button type="submit" className="btn primary" disabled={!validName || saving}>{submitLabel}</button>
        <button type="button" className="btn ghost" disabled={saving} onClick={onCancel}>{t("Cancelar")}</button>
      </div>
    </form>
  );
}

export function useProjectDetailsDialog() {
  const t = useT();
  const app = useApp();
  const router = useRouter();
  const [target, setTarget] = useState<Omit<ProjectSummary, "parentId"> | "new" | null>(null);
  const close = () => setTarget(null);
  const project = target === "new" ? undefined : target ?? undefined;
  // O projeto principal vem da navegação, que conhece a árvore inteira.
  const currentParent = project ? app.nav?.projects.find((candidate) => candidate.id === project.id)?.parentId ?? null : null;

  const dialog = (
    <Dialog open={target !== null} onClose={close} title={project ? t("Editar projeto") : t("Novo projeto")}>
      {target && <div className="dialog-b">
        <NamedDetailsForm key={project?.id ?? "new"} kind="projeto" initial={project && { ...project, parentId: currentParent }}
          projectId={project?.id} inDialog
          submitLabel={project ? t("Salvar") : t("Criar projeto")} onCancel={close} onSave={async ({ parentId = null, ...details }) => {
            const parentChanged = parentId !== currentParent;
            if (project && details.name === project.name && details.description === project.description
              && details.color === project.color && details.icon === project.icon && !parentChanged) {
              close();
              return;
            }
            const saved = await app.run(
              () => project
                ? api.projects.edit(project.id, project.revision, parentChanged ? { ...details, parentId } : details)
                : api.projects.create({ ...details, color: details.color ?? null, icon: details.icon ?? "hash", parentId }),
              { success: project ? t("Projeto atualizado") : t("Projeto criado"), revalidate: project ? refreshProjects : (key) => key === "nav" },
            );
            if (!saved) return;
            close();
            if (!project) router.push(`/projetos/${saved.id}`);
          }} />
      </div>}
    </Dialog>
  );
  return { dialog, create: () => setTarget("new"), edit: (project: Omit<ProjectSummary, "parentId">) => setTarget(project) };
}

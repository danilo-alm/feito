"use client";
import { useState } from "react";
import { api } from "@/client/api";
import { useQuery } from "@/client/store";
import type { Frequency, Label, Priority, ProjectPage } from "@/client/types";
import { useApp } from "./app";
import { IconCheck, IconFlag, IconHash, IconInbox, IconPlus } from "./icons";
import { Collapse } from "./motion";

export const PRIORITY_NAMES: Record<Priority, string> = {
  1: "Prioridade 1", 2: "Prioridade 2", 3: "Prioridade 3", 4: "Sem prioridade",
};

export function PriorityMenu({ value, onPick }: { value: Priority; onPick: (priority: Priority) => void }) {
  return (
    <div className="menu" role="listbox" aria-label="Prioridade">
      {([1, 2, 3, 4] as Priority[]).map((priority) => (
        <button key={priority} type="button" role="option" aria-selected={value === priority} className={`mi p${priority}`}
          onClick={() => onPick(priority)}>
          <IconFlag style={{ color: "var(--pc)" }} />
          <span style={{ flex: 1 }}>P{priority} · {PRIORITY_NAMES[priority]}</span>
          {value === priority && <IconCheck />}
        </button>
      ))}
    </div>
  );
}

export const FREQUENCIES: { value: Frequency | null; label: string }[] = [
  { value: null, label: "Não repete" },
  { value: "daily", label: "Diária" },
  { value: "weekly", label: "Semanal, no mesmo dia da semana" },
  { value: "monthly", label: "Mensal, no mesmo dia do mês" },
];

export function RepeatMenu({ value, onPick }: { value: Frequency | null; onPick: (value: Frequency | null) => void }) {
  return (
    <div className="menu" role="listbox" aria-label="Repetir">
      {FREQUENCIES.map((option) => (
        <button key={option.label} type="button" role="option" aria-selected={value === option.value} className="mi"
          onClick={() => onPick(option.value)}>
          <span style={{ flex: 1 }}>{option.label}</span>
          {value === option.value && <IconCheck />}
        </button>
      ))}
    </div>
  );
}

export function LabelPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const app = useApp();
  const labels = useQuery<{ labels: Label[] }>("labels", api.labels.list);
  const [text, setText] = useState("");
  const all = labels.data?.labels ?? [];
  const needle = text.trim().toLocaleLowerCase("pt-BR");
  const visible = all.filter((label) => !needle || label.name.toLocaleLowerCase("pt-BR").includes(needle));
  const exact = all.some((label) => label.name.toLocaleLowerCase("pt-BR") === needle);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const create = async () => {
    const name = text.trim();
    if (!name) return;
    const label = await app.run(() => api.labels.create(name), { success: `Etiqueta “${name}” criada` });
    if (label) {
      onChange([...selected, label.id]);
      setText("");
      void labels.reload();
    }
  };
  return (
    <div style={{ padding: 8, width: 260, display: "flex", flexDirection: "column", gap: 6 }}>
      <label className="sr-only" htmlFor="label-filter">Buscar ou criar etiqueta</label>
      <input id="label-filter" className="inline-input" placeholder="Buscar ou criar etiqueta" value={text} data-autofocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!exact) void create(); } }} />
      <div className="menu" style={{ padding: 0, minWidth: 0, maxHeight: 240, overflow: "auto" }} role="listbox" aria-multiselectable="true" aria-label="Etiquetas">
        {visible.map((label) => (
          <button key={label.id} type="button" role="option" aria-selected={selected.includes(label.id)} className="mi"
            onClick={() => toggle(label.id)}>
            <span style={{ width: 16, display: "grid", placeItems: "center" }}>{selected.includes(label.id) && <IconCheck />}</span>
            <span style={{ flex: 1 }}>{label.name}</span>
          </button>
        ))}
        {needle && !exact && (
          <button type="button" className="mi" onClick={() => void create()}>
            <IconPlus /><span>Criar “{text.trim()}”</span>
          </button>
        )}
        {!visible.length && !needle && <p className="hint" style={{ padding: 8 }}>Nenhuma etiqueta ainda. Digite para criar.</p>}
      </div>
    </div>
  );
}

export function DestinationPicker({ projectId, sectionId, onPick }: {
  projectId: string; sectionId: string | null; onPick: (projectId: string, sectionId: string | null) => void;
}) {
  const app = useApp();
  const [expanded, setExpanded] = useState<string | null>(projectId);
  const page = useQuery<ProjectPage>(expanded ? `project:${expanded}` : null, () => api.projects.get(expanded!));
  const inboxId = app.nav?.inbox.projectId ?? app.me.inboxProjectId;
  const projects = app.nav?.projects ?? [];
  return (
    <div className="menu" style={{ maxHeight: 340, overflow: "auto", width: 280 }} role="listbox" aria-label="Destino">
      <button type="button" role="option" aria-selected={projectId === inboxId} className="mi" onClick={() => onPick(inboxId, null)}>
        <IconInbox /><span style={{ flex: 1 }}>Caixa de entrada</span>{projectId === inboxId && <IconCheck />}
      </button>
      {projects.map((project) => (
        <div key={project.id}>
          <button type="button" className="mi" aria-expanded={expanded === project.id}
            onClick={() => setExpanded(expanded === project.id ? null : project.id)}>
            <IconHash /><span style={{ flex: 1 }}>{project.name}</span>
          </button>
          <Collapse open={expanded === project.id && page.data?.project.id === project.id}>
            {page.data && [{ id: null as string | null, name: "Sem seção" }, ...page.data.sections].map((section) => (
              <button key={section.id ?? "none"} type="button" role="option" className="mi" style={{ paddingLeft: 36 }}
                aria-selected={projectId === project.id && sectionId === section.id}
                onClick={() => onPick(project.id, section.id)}>
                <span style={{ flex: 1 }}>{section.name}</span>
                {projectId === project.id && sectionId === section.id && <IconCheck />}
              </button>
            ))}
          </Collapse>
        </div>
      ))}
    </div>
  );
}

export function destinationLabel(app: ReturnType<typeof useApp>, projectId: string, sectionName?: string | null) {
  if (projectId === (app.nav?.inbox.projectId ?? app.me.inboxProjectId)) return "Caixa de entrada";
  const project = app.nav?.projects.find((item) => item.id === projectId);
  return sectionName ? `${project?.name ?? "Projeto"} / ${sectionName}` : project?.name ?? "Projeto";
}

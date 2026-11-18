"use client";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "@/client/api";
import { dateLabel } from "@/client/dates";
import { getQueryData } from "@/client/store";
import type { Frequency, Label, Priority, ProjectPage } from "@/client/types";
import { refreshAll, useApp, type QuickAddDefaults } from "./app";
import { IconCalendar, IconChevronDown, IconClock, IconFlag, IconHash, IconInbox, IconRepeat, IconSub, IconTag, IconX } from "./icons";
import { DestinationPicker, FREQUENCIES, LabelPicker, PriorityMenu, RepeatMenu, destinationLabel } from "./pickers";
import { DatePicker } from "./task-row";
import { Dialog, Popover, useToast } from "./ui";

type Pop = "date" | "time" | "repeat" | "priority" | "labels" | "dest" | null;

function inferDefaults(pathname: string, reference: string): QuickAddDefaults {
  if (pathname.startsWith("/hoje")) return { dueDate: reference };
  const project = pathname.match(/^\/projetos\/([^/]+)/);
  if (project) return { projectId: project[1] };
  const label = pathname.match(/^\/etiquetas\/([^/]+)/);
  if (label) return { labelIds: [label[1]] };
  return {};
}

export function QuickAdd({ defaults, onClose }: { defaults: QuickAddDefaults | null; onClose: () => void }) {
  const app = useApp();
  const toast = useToast();
  const pathname = usePathname();
  const open = defaults !== null;
  const initial = useMemo(() => {
    if (!defaults) return null;
    return Object.keys(defaults).length ? defaults : inferDefaults(pathname, app.reference);
  }, [defaults, pathname, app.reference]);

  const inboxId = app.nav?.inbox.projectId ?? app.me.inboxProjectId;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [priority, setPriority] = useState<Priority>(4);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState(inboxId);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [busy, setBusy] = useState(false);
  const anchors = useRef<Record<string, HTMLButtonElement | null>>({});
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initial) return;
    setTitle("");
    setDescription("");
    setDueDate(initial.dueDate ?? null);
    setDueTime(null);
    setFrequency(null);
    setPriority(4);
    setLabelIds(initial.labelIds ?? []);
    setProjectId(initial.projectId ?? inboxId);
    setSectionId(initial.sectionId ?? null);
    setPop(null);
  }, [initial, inboxId]);

  const parentId = initial?.parentId ?? null;
  const parentTitle = parentId ? getQueryData<{ title: string }>(`task:${parentId}`)?.title : undefined;
  const sectionName = sectionId
    ? getQueryData<ProjectPage>(`project:${projectId}`)?.sections.find((section) => section.id === sectionId)?.name
    : null;
  const labels = getQueryData<{ labels: Label[] }>("labels")?.labels ?? app.nav?.labels ?? [];

  const submit = async () => {
    const text = title.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.tasks.create({
        title: text,
        description: description.trim() ? description : undefined,
        ...(parentId ? { parentId } : { projectId, sectionId }),
        priority,
        dueDate: frequency ? dueDate ?? app.reference : dueDate,
        dueTime: dueDate || frequency ? dueTime : null,
        labelIds,
        recurrence: frequency && !parentId ? { frequency, anchorDate: dueDate ?? app.reference, time: dueTime } : undefined,
      });
      toast(`Tarefa adicionada em ${parentId ? `“${parentTitle ?? "tarefa"}”` : destinationLabel(app, projectId, sectionName)}`);
      setTitle("");
      setDescription("");
      titleRef.current?.focus();
      void refreshAll();
    } catch (error) {
      toast(errorMessage(error), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  const chip = (key: Exclude<Pop, null>, content: React.ReactNode, active: boolean, label: string) => (
    <button type="button" ref={(node) => { anchors.current[key] = node; }} className={`pill${active ? " on" : ""}`}
      aria-haspopup="dialog" aria-expanded={pop === key} aria-label={label} onClick={() => setPop(pop === key ? null : key)}>
      {content}
    </button>
  );
  const closePop = () => setPop(null);

  return (
    <Dialog open={open} onClose={onClose} title="Adicionar tarefa" hideHeader initialFocus={titleRef} width={640}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}
        style={{ padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {parentId && <div className="crumb"><IconSub className="sm" />Subtarefa de {parentTitle ?? "tarefa"}</div>}
        <label htmlFor="qa-title" className="sr-only">Título da tarefa</label>
        <input id="qa-title" ref={titleRef} className="qa-title" placeholder="Nome da tarefa" value={title} maxLength={500}
          autoComplete="off" onChange={(event) => setTitle(event.target.value)} />
        <label htmlFor="qa-desc" className="sr-only">Descrição</label>
        <textarea id="qa-desc" className="qa-desc" rows={2} placeholder="Descrição (opcional)" value={description}
          onChange={(event) => setDescription(event.target.value)} />
        <div className="chips">
          {chip("date", <><IconCalendar />{dueDate ? dateLabel(dueDate, app.reference) : "Data"}</>, !!dueDate, "Data")}
          {(dueDate || frequency) && chip("time", <><IconClock />{dueTime ?? "Hora"}</>, !!dueTime, "Hora")}
          {!parentId && chip("repeat", <><IconRepeat />{FREQUENCIES.find((option) => option.value === frequency)?.label.split(",")[0] ?? "Repetir"}</>, !!frequency, "Repetir")}
          {chip("priority", <><IconFlag style={{ color: "var(--pc)" }} />{priority < 4 ? `P${priority}` : "Prioridade"}</>, priority < 4, "Prioridade")}
          {chip("labels", <><IconTag />{labelIds.length
            ? labelIds.map((id) => labels.find((label) => label.id === id)?.name ?? "etiqueta").join(", ")
            : "Etiqueta"}</>, labelIds.length > 0, "Etiquetas")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", margin: "6px -20px 0", padding: "12px 20px 0", flexWrap: "wrap" }}>
          {!parentId && chip("dest", <>{projectId === inboxId ? <IconInbox /> : <IconHash />}{destinationLabel(app, projectId, sectionName)}<IconChevronDown className="sm" /></>, false, "Destino")}
          <span className="hint desktop-only" style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 4 }}>
            <span className="kbd">Enter</span>adiciona <span className="kbd">Esc</span>fecha
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={!title.trim() || busy}>Adicionar tarefa</button>
        </div>
      </form>

      <Popover anchor={anchors.current.date ?? null} open={pop === "date"} onClose={closePop} label="Data">
        <DatePicker value={dueDate} reference={app.reference} onClose={closePop} allowClear={!frequency}
          onPick={(date) => { setDueDate(date); if (!date) setDueTime(null); }} />
      </Popover>
      <Popover anchor={anchors.current.time ?? null} open={pop === "time"} onClose={closePop} label="Hora">
        <div className="date-pop">
          <label className="lbl" htmlFor="qa-time">Horário</label>
          <input id="qa-time" type="time" value={dueTime ?? ""} data-autofocus onChange={(event) => setDueTime(event.target.value || null)} />
          {dueTime && <button type="button" className="mi" onClick={() => { setDueTime(null); closePop(); }}><IconX />Sem horário</button>}
        </div>
      </Popover>
      <Popover anchor={anchors.current.repeat ?? null} open={pop === "repeat"} onClose={closePop} label="Repetir">
        <RepeatMenu value={frequency} onPick={(value) => { setFrequency(value); if (value && !dueDate) setDueDate(app.reference); closePop(); }} />
      </Popover>
      <Popover anchor={anchors.current.priority ?? null} open={pop === "priority"} onClose={closePop} label="Prioridade">
        <PriorityMenu value={priority} onPick={(value) => { setPriority(value); closePop(); }} />
      </Popover>
      <Popover anchor={anchors.current.labels ?? null} open={pop === "labels"} onClose={closePop} label="Etiquetas">
        <LabelPicker selected={labelIds} onChange={setLabelIds} />
      </Popover>
      <Popover anchor={anchors.current.dest ?? null} open={pop === "dest"} onClose={closePop} label="Destino">
        <DestinationPicker projectId={projectId} sectionId={sectionId}
          onPick={(project, section) => { setProjectId(project); setSectionId(section); closePop(); }} />
      </Popover>
    </Dialog>
  );
}

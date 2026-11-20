"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  addDays, dateLabel, dayOfMonth, daysBetween, daysInMonth, dueTone, longDate, monthShort, monthStart, nextWeek, parseDueInput, shortDate,
  weekday, weekdayShort, weekend,
} from "@/client/dates";
import { api } from "@/client/api";
import { useQuery } from "@/client/store";
import type { Frequency, Label, Priority, ProjectPage } from "@/client/types";
import { useApp } from "./app";
import {
  DueIcon, IconBan, IconCalendar, IconCalendarDay, IconCheck, IconChevronLeft, IconChevronRight, IconFlag, IconInbox, IconNextWeek,
  IconPlus, IconSofa, IconSun,
} from "./icons";
import { ProjectGlyph } from "./project-style";
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

export function TimePicker({ value, onPick }: { value: string | null; onPick: (time: string | null) => void }) {
  const [hour, setHour] = useState<number | null>(() => value ? Number(value.slice(0, 2)) : null);
  const [minute, setMinute] = useState<number | null>(() => value ? Number(value.slice(3, 5)) : null);

  useEffect(() => {
    setHour(value ? Number(value.slice(0, 2)) : null);
    setMinute(value ? Number(value.slice(3, 5)) : null);
  }, [value]);

  return (
    <div className="time-pop">
      <div className="time-columns">
        <div className="time-column">
          <span className="lbl">Hora</span>
          <div className="time-options" role="listbox" aria-label="Hora">
            {Array.from({ length: 24 }, (_, option) => (
              <button key={option} type="button" role="option" aria-selected={hour === option}
                className={`time-option${hour === option ? " on" : ""}`} data-autofocus={hour === option || undefined}
                onClick={() => setHour(option)}>{String(option).padStart(2, "0")}</button>
            ))}
          </div>
        </div>
        <div className="time-column">
          <span className="lbl">Minuto</span>
          <div className="time-options" role="listbox" aria-label="Minuto">
            {Array.from({ length: 60 }, (_, option) => (
              <button key={option} type="button" role="option" aria-selected={minute === option}
                className={`time-option${minute === option ? " on" : ""}`} data-autofocus={minute === option || undefined}
                onClick={() => setMinute(option)}>{String(option).padStart(2, "0")}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="time-actions">
        {value && <button type="button" className="btn ghost" onClick={() => onPick(null)}>Sem horário</button>}
        <button type="button" className="btn primary" disabled={hour === null || minute === null} style={{ marginLeft: "auto" }}
          onClick={() => onPick(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)}>Salvar</button>
      </div>
    </div>
  );
}

export function LabelPicker({ selected, onChange }: { selected: string[]; onChange: (update: (current: string[]) => string[]) => void }) {
  const id = useId();
  const app = useApp();
  const labels = useQuery<{ labels: Label[] }>("labels", api.labels.list);
  const [text, setText] = useState("");
  const all = labels.data?.labels ?? [];
  const needle = text.trim().toLocaleLowerCase("pt-BR");
  const visible = all.filter((label) => !needle || label.name.toLocaleLowerCase("pt-BR").includes(needle));
  const exact = all.some((label) => label.name.toLocaleLowerCase("pt-BR") === needle);
  const toggle = (id: string) => onChange((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const create = async () => {
    const name = text.trim();
    if (!name) return;
    const label = await app.run(() => api.labels.create(name), { success: `Etiqueta “${name}” criada`, revalidate: (key) => key === "nav" || key === "labels" });
    if (label) {
      onChange((current) => current.includes(label.id) ? current : [...current, label.id]);
      setText("");
      void labels.reload();
    }
  };
  return (
    <div style={{ padding: 8, width: 260, display: "flex", flexDirection: "column", gap: 6 }}>
      <label className="sr-only" htmlFor={id}>Buscar ou criar etiqueta</label>
      <input id={id} className="inline-input" placeholder="Buscar ou criar etiqueta" value={text} data-autofocus
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
            <ProjectGlyph id={project.id} /><span style={{ flex: 1 }}>{project.name}</span>
          </button>
          <Collapse open={expanded === project.id && page.data?.project.id === project.id}>
            {page.data && [{ id: null, name: page.data.project.defaultSectionName ?? "Sem seção" }, ...page.data.sections].map((section) => (
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

const WEEK_HEAD = ["D", "S", "T", "Q", "Q", "S", "S"];
const CALENDAR_MONTHS = 18;

/**
 * Seletor de vencimento: campo de texto ("sexta", "25/12"…), atalhos e um calendário rolável
 * com os meses em sequência. É o mesmo no editor, no detalhe e no "Escolher data…" do menu da tarefa.
 */
export function DatePicker({ value, reference, onPick, onClose, allowClear = true, autoFocus = false }: {
  value: string | null; reference: string; onPick: (date: string | null) => void; onClose: () => void; allowClear?: boolean; autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const typed = text.trim() ? parseDueInput(text, reference) : null;
  const pick = (date: string | null) => { onPick(date); onClose(); };

  const options = [
    { label: "Hoje", date: reference, icon: <IconCalendarDay day={dayOfMonth(reference)} />, className: "c-today" },
    { label: "Amanhã", date: addDays(reference, 1), icon: <IconSun />, className: "c-tomorrow" },
    { label: "Este fim de semana", date: weekend(reference), icon: <IconSofa />, className: "c-weekend" },
    { label: "Próxima semana", date: nextWeek(reference), icon: <IconNextWeek />, className: "c-week", full: true },
  ];

  return (
    <div className="due-pop">
      {/* Portal: eventos React ainda sobem até o formulário do editor; o Enter daqui não pode salvar a tarefa. */}
      <form className="due-input" onKeyDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); if (typed) pick(typed); }}>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Digite um vencimento"
          aria-label="Digite um vencimento" data-autofocus autoFocus={autoFocus} autoComplete="off" spellCheck={false} />
        {text.trim() && (
          typed
            ? <button type="submit" className={`due-typed tone-${dueTone(typed, reference)}`} aria-label={longDate(typed)}>
              <DueIcon tone={dueTone(typed, reference)} day={dayOfMonth(typed)} />
              <span>{`${shortDate(typed)} ${typed.slice(0, 4)}`}</span>
              {Math.abs(daysBetween(reference, typed)) <= 1 && <span className="sub">{dateLabel(typed, reference)}</span>}</button>
            : <p className="due-typed none">Não reconheci essa data</p>
        )}
      </form>
      <div className="due-options">
        {options.map((option) => (
          <button key={option.label} type="button" className={`due-option${value === option.date ? " on" : ""}`}
            onClick={() => pick(option.date)}>
            <span className={`due-icon ${option.className}`}>{option.icon}</span>
            <span className="due-name">{option.label}</span>
            <span className="sub">{"full" in option ? shortDate(option.date) : weekdayShort(option.date)}</span>
          </button>
        ))}
        {allowClear && (
          <button type="button" className={`due-option${value ? "" : " on"}`} onClick={() => pick(null)}>
            <span className="due-icon"><IconBan /></span><span className="due-name">Sem vencimento</span>
          </button>
        )}
      </div>
      <MonthScroller value={value} reference={reference} onPick={pick} />
    </div>
  );
}

function MonthScroller({ value, reference, onPick }: { value: string | null; reference: string; onPick: (date: string) => void }) {
  const first = monthStart(value && value < reference ? value : reference);
  const last = monthStart(value && value > reference ? value : reference, CALENDAR_MONTHS - 1);
  const months: string[] = [];
  for (let month = first; month <= last; month = monthStart(month, 1)) months.push(month);

  const scroller = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(monthStart(value ?? reference));

  const sectionOf = (month: string) => scroller.current?.querySelector<HTMLElement>(`[data-month="${month}"]`);
  const scrollTo = (month: string, behavior: ScrollBehavior = "smooth") => {
    const node = sectionOf(month);
    if (node && scroller.current) scroller.current.scrollTo({ top: node.offsetTop, behavior });
  };

  // Abre no mês da data escolhida (ou no atual), sem animação.
  useLayoutEffect(() => {
    scrollTo(monthStart(value ?? reference), "instant");
  }, []);

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    const top = box.scrollTop + 8;
    let current = months[0];
    for (const node of box.querySelectorAll<HTMLElement>("[data-month]")) {
      if (node.offsetTop <= top) current = node.dataset.month!;
    }
    setVisible(current);
  };

  const index = months.indexOf(visible);
  return (
    <div className="cal">
      <div className="cal-head">
        <strong aria-live="polite">{monthShort(visible)}</strong>
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label="Mês anterior" disabled={index <= 0}
            onClick={() => scrollTo(months[index - 1])}><IconChevronLeft /></button>
          <button type="button" className="icon-btn cal-today" aria-label="Voltar para hoje" title="Hoje"
            onClick={() => scrollTo(monthStart(reference))}><span /></button>
          <button type="button" className="icon-btn" aria-label="Próximo mês" disabled={index >= months.length - 1}
            onClick={() => scrollTo(months[index + 1])}><IconChevronRight /></button>
        </div>
      </div>
      <div className="cal-week" aria-hidden="true">{WEEK_HEAD.map((day, i) => <span key={i}>{day}</span>)}</div>
      <div className="cal-scroll" ref={scroller} onScroll={onScroll}>
        {months.map((month, position) => (
          <section key={month} data-month={month} aria-label={monthShort(month)}>
            {position > 0 && <h4 className="cal-month">{monthShort(month, month.slice(0, 4) !== reference.slice(0, 4))}</h4>}
            <div className="cal-grid">
              {Array.from({ length: weekday(month) }, (_, i) => <span key={`pad-${i}`} />)}
              {Array.from({ length: daysInMonth(month) }, (_, i) => {
                const date = addDays(month, i);
                const state = date === value ? "picked" : date === reference ? "today" : date < reference ? "past" : "";
                return (
                  <button key={date} type="button" className={`cal-day ${state}`} aria-label={longDate(date)}
                    aria-pressed={date === value} aria-current={date === reference ? "date" : undefined}
                    onClick={() => onPick(date)}>{i + 1}</button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

"use client";
import type { Layout, Me, Preferences, ProjectView, TaskItem } from "@feito/core/types";
import { api } from "../client/api";
import { setQueryData } from "../client/store";
import { useApp } from "./app";
import { AgendaCalendar } from "./project-calendar";
import { TaskTable } from "./project-table";
import { IconPlus } from "./icons";
import { useT } from "./language";
import { useTaskActions } from "./task-actions";
import { AddTaskSlot } from "./task-editor";
import { TaskRow } from "./task-row";
import { ViewMenu } from "./view-menu";

type Actions = ReturnType<typeof useTaskActions>;
type AgendaKey = "todayLayout" | "upcomingLayout";

/** Grupo fixo de uma agenda: “Atrasadas” ou um dia. O usuário não edita os grupos, só vê as tarefas neles. */
export type AgendaGroup = { key: string; title: string; tasks: TaskItem[]; date?: string; late?: boolean };

/** Layout de uma agenda; Hoje também tem a Agenda por horário. */
export type AgendaView = Layout | "timeline";

/** Layout de Hoje ou Em breve, guardado nas preferências da conta e aplicado na hora. Hoje abre na Agenda. */
export function useAgendaLayout(key: AgendaKey) {
  const app = useApp();
  const preferences = app.me.preferences;
  const timeline = key === "todayLayout" && preferences.todayTimeline !== false;
  const savedLayout = preferences[key] ?? "list";
  const layout: AgendaView = timeline ? "timeline" : key === "todayLayout" && savedLayout === "calendar" ? "list" : savedLayout;
  const setLayout = (next: AgendaView) => {
    if (next === layout) return;
    const patch: Partial<Preferences> = next === "timeline" ? { todayTimeline: true }
      : key === "todayLayout" ? { todayLayout: next, todayTimeline: false } : { [key]: next };
    const previous: Partial<Preferences> = { [key]: preferences[key], todayTimeline: preferences.todayTimeline };
    const apply = (values: Partial<Preferences>) =>
      setQueryData<Me>("me", (me) => me && { ...me, preferences: { ...me.preferences, ...values } });
    apply(patch);
    void app.run(() => api.preferences(patch)).then((saved) => {
      if (saved) setQueryData<Me>("me", (me) => me && { ...me, preferences: saved });
      else apply(previous);
    });
  };
  return [layout, setLayout] as const;
}

/** Botão Mostrar das agendas: só o layout, com os dias como grupos. */
export function AgendaViewMenu({ layout, onChange, withTimeline = false }: {
  layout: AgendaView; onChange: (layout: AgendaView) => void; withTimeline?: boolean;
}) {
  const view: ProjectView = { layout: layout === "timeline" ? "list" : layout, sortMode: "date", showCompleted: false };
  return <ViewMenu view={view} scope="agenda" onChange={(patch) => patch.layout && onChange(patch.layout)}
    timeline={withTimeline ? { on: layout === "timeline", onPick: () => onChange("timeline") } : undefined}
    hideCalendar={withTimeline} />;
}

/** Quadro somente leitura: uma coluna por grupo da agenda. */
function AgendaBoard({ groups, actions }: { groups: AgendaGroup[]; actions: Actions }) {
  const t = useT();
  return (
    <div className="board agenda-board">
      {groups.map((group) => {
        const active = group.tasks.filter((task) => task.status === "active");
        return (
          <section key={group.key} className="column" aria-label={t("Coluna {0}", [group.title])} data-flip={`agenda-col:${group.key}`}>
            <div className={`col-h${group.late ? " late" : ""}`}>{group.title}<span className="count">{active.length}</span></div>
            {group.tasks.map((task) => <TaskRow key={task.id} task={task} actions={actions} variant="card" showOrigin timeOnly={!!group.date} />)}
            {!group.tasks.length && <p className="hint agenda-empty">{t("Nada planejado.")}</p>}
            {group.date && (
              <AddTaskSlot slot={`add:agenda:${group.date}`} defaults={{ dueDate: group.date }}>
                {(start) => (
                  <button type="button" className="col-add" data-flip={`col-add:agenda:${group.key}`} onClick={start}>
                    <IconPlus className="plus" />{t("Adicionar tarefa")}</button>
                )}
              </AddTaskSlot>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Layouts que ocupam a largura toda; a Lista é a própria tela, e no celular a Tabela vira Lista, como nos projetos. */
export function isWideAgenda(layout: AgendaView, phone: boolean): layout is Layout {
  return layout === "board" || layout === "calendar" || (layout === "table" && !phone);
}

/** Hoje e Em breve em Painel, Calendário ou Tabela, com os mesmos grupos da Lista. Só é usado quando `isWideAgenda`. */
export function AgendaLayout({ layout, groups, dates, actions, mobile }: {
  layout: Layout; groups: AgendaGroup[]; dates: string[]; actions: Actions; mobile: boolean;
}) {
  const t = useT();
  const app = useApp();
  if (layout === "board") return <AgendaBoard groups={groups} actions={actions} />;
  if (layout === "calendar") {
    const late = groups.find((group) => group.late);
    return (
      <AgendaCalendar dates={dates} tasks={groups.filter((group) => !group.late).flatMap((group) => group.tasks)}
        side={late && { title: late.title, tasks: late.tasks }} actions={actions} mobile={mobile}
        onAdd={(date) => app.openQuickAdd({ dueDate: date })} />
    );
  }
  if (layout === "table") {
    return (
      <TaskTable flat label={t("Tarefas")} actions={actions} archived={false} tasks={groups.flatMap((group) => group.tasks)}
        groups={groups.map((group) => ({
          key: group.key, title: group.title, roots: group.tasks,
          add: group.date ? { slot: `add:agenda:${group.date}`, defaults: { dueDate: group.date } } : undefined,
        }))} />
    );
  }
  return null;
}

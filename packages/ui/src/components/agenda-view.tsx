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

/** Layout de Hoje ou Em breve, guardado nas preferências da conta e aplicado na hora. */
export function useAgendaLayout(key: AgendaKey) {
  const app = useApp();
  const layout: Layout = app.me.preferences[key] ?? "list";
  const setLayout = (next: Layout) => {
    if (next === layout) return;
    const patch: Partial<Preferences> = { [key]: next };
    const apply = (value: Layout) =>
      setQueryData<Me>("me", (me) => me && { ...me, preferences: { ...me.preferences, [key]: value } });
    apply(next);
    void app.run(() => api.preferences(patch)).then((saved) => {
      if (saved) setQueryData<Me>("me", (me) => me && { ...me, preferences: saved });
      else apply(layout);
    });
  };
  return [layout, setLayout] as const;
}

/** Botão Mostrar das agendas: só o layout, com os dias como grupos. */
export function AgendaViewMenu({ layout, onChange }: { layout: Layout; onChange: (layout: Layout) => void }) {
  const view: ProjectView = { layout, sortMode: "date", showCompleted: false };
  return <ViewMenu view={view} scope="agenda" onChange={(patch) => patch.layout && onChange(patch.layout)} />;
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
export function isWideAgenda(layout: Layout, mobile: boolean) {
  return layout === "board" || layout === "calendar" || (layout === "table" && !mobile);
}

/** Hoje e Em breve em Painel, Calendário ou Tabela, com os mesmos grupos da Lista. */
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
  if (layout === "table" && !mobile) {
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

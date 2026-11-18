"use client";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor,
  useSensors, type CollisionDetection, type DragMoveEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, ApiFailure, errorMessage } from "@/client/api";
import { editKey, insertKey, useEditorOpen } from "@/client/editor-store";
import { invalidate, useQuery } from "@/client/store";
import {
  applyStep, keyboardPlan, menuActions, resolveDrop, sectionName, type DropOver, type KeyAction, type Plan, type Zone,
} from "@/client/tree";
import type { MoveTarget, ProjectPage, TaskItem } from "@/client/types";
import { useApp } from "./app";
import { PageHeader } from "./chrome";
import { Collapse, flipFrom } from "./motion";
import { IconArchive, IconArrowDown, IconArrowUp, IconBan, IconEdit, IconMore, IconPlus, IconSub, IconTrash } from "./icons";
import { useTaskActions } from "./task-actions";
import { AddTaskSlot, CreateSlot, useStartCreate } from "./task-editor";
import { TaskRow, type ArrangeItem, type InsertSide } from "./task-row";
import { MenuButton, Spinner, useIsMobile, useToast, type MenuItem } from "./ui";
import { LAYOUT_LABEL, SORT_LABEL, ViewMenu } from "./view-menu";

const GROUP = (sectionId: string | null) => `group:${sectionId ?? "none"}`;

// Posição real do ponteiro durante o arraste (o delta da biblioteca inclui a rolagem automática).
let lastPointerY: number | null = null;
const trackPointer = (event: PointerEvent | TouchEvent) => {
  lastPointerY = "touches" in event ? event.touches[0]?.clientY ?? lastPointerY : event.clientY;
};

function pointerY(event: DragMoveEvent) {
  if (lastPointerY !== null) return lastPointerY;
  const start = event.activatorEvent as MouseEvent & TouchEvent;
  const y = "touches" in start && start.touches?.length ? start.touches[0].clientY : (start as MouseEvent).clientY;
  return y + event.delta.y;
}

// Enquanto um arraste por toque está ativo, a rolagem nativa da página fica bloqueada.
// O ouvinte é registrado antes do gesto (não passivo) para que o navegador aceite o preventDefault;
// antes da ativação por toque prolongado, a rolagem continua normal.
let dragActive = false;
const blockScroll = (event: TouchEvent) => {
  if (dragActive && event.cancelable) event.preventDefault();
};

function useTouchScrollGuard() {
  useEffect(() => {
    document.addEventListener("touchmove", blockScroll, { passive: false });
    return () => document.removeEventListener("touchmove", blockScroll);
  }, []);
}

function listenPointer(on: boolean) {
  dragActive = on;
  const method = on ? "addEventListener" : "removeEventListener";
  window[method]("pointermove", trackPointer as EventListener, { capture: true, passive: true } as AddEventListenerOptions);
  window[method]("touchmove", trackPointer as EventListener, { capture: true, passive: true } as AddEventListenerOptions);
  if (!on) lastPointerY = null;
}

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const tasks = hits.filter((hit) => String(hit.id).startsWith("task:"));
  if (tasks.length) return tasks;
  return hits.length ? hits : rectIntersection(args);
};

type DragState = { activeId: string; over: DropOver | null; plan: Plan | null };

export function ProjectView({ projectId }: { projectId: string }) {
  const app = useApp();
  const toast = useToast();
  const router = useRouter();
  const mobile = useIsMobile();
  const actions = useTaskActions();
  const startCreate = useStartCreate();
  const key = `project:${projectId}`;
  const query = useQuery<ProjectPage>(key, () => api.projects.get(projectId));
  const page = query.data?.project.id === projectId ? query.data : undefined;
  const [drag, setDrag] = useState<DragState | null>(null);
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    if (query.error instanceof ApiFailure && query.error.code === "NOT_FOUND") router.replace("/hoje");
  }, [query.error, router]);

  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    const node = document.querySelector<HTMLElement>(`[data-task-id="${id}"] .t-click`);
    if (node) {
      node.focus();
      focusAfter.current = null;
    }
  }, [page]);

  useTouchScrollGuard();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
  );

  // Movimentos em fila: cada passo usa a revisão mais recente devolvida pelo servidor.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const revisions = useRef(new Map<string, number>());

  const execute = useCallback((taskId: string, plan: Plan, focus = false) => {
    if (!page) return Promise.resolve();
    if (!plan.valid) {
      toast(plan.message, { bad: true });
      return Promise.resolve();
    }
    query.mutate((current) => current && plan.steps.reduce((value, step) => applyStep(value, taskId, step), current));
    if (focus) focusAfter.current = taskId;
    const known = page.tasks.find((task) => task.id === taskId)?.revision ?? 1;
    const run = async () => {
      try {
        let revision = Math.max(known, revisions.current.get(taskId) ?? 0);
        for (const step of plan.steps as MoveTarget[]) {
          const result = await api.tasks.move(taskId, revision, step);
          revision = result.task.revision;
          revisions.current.set(taskId, revision);
        }
        toast(plan.message);
      } catch (error) {
        toast(error instanceof ApiFailure && error.code === "REVISION_CONFLICT"
          ? "A lista mudou em outra aba. A posição original foi restaurada."
          : `${errorMessage(error)} A tarefa voltou ao lugar.`, { bad: true });
      } finally {
        await invalidate();
      }
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  }, [page, query, toast]);

  const arrange = useCallback((taskId: string, action: KeyAction) => {
    if (!page) return;
    const plan = keyboardPlan(page, taskId, action);
    if (plan) void execute(taskId, plan, true);
  }, [page, execute]);

  const onKeyArrange = useCallback((task: TaskItem) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.altKey || !page) return;
    const board = page.project.view.layout === "board";
    let action: KeyAction | null = null;
    if (event.key === "ArrowUp") action = "up";
    else if (event.key === "ArrowDown") action = "down";
    else if (event.key === "ArrowRight") action = board && event.shiftKey ? "right" : "nest";
    else if (event.key === "ArrowLeft") action = board && event.shiftKey ? "left" : "promote";
    if (!action) return;
    event.preventDefault();
    arrange(task.id, action);
  }, [page, arrange]);

  const changeView = async (patch: Parameters<typeof api.projects.setView>[1]) => {
    if (!page) return;
    query.mutate((current) => current && { ...current, project: { ...current.project, view: { ...current.project.view, ...patch } } });
    await app.run(() => api.projects.setView(projectId, patch), {
      success: patch.layout ? `${LAYOUT_LABEL[patch.layout]} — mesma organização do projeto`
        : patch.sortMode ? (patch.sortMode === "manual" ? "Ordem manual recuperada" : `Ordenado por ${SORT_LABEL[patch.sortMode].toLowerCase()}`)
          : undefined,
    });
  };

  if (!page) return <><PageHeader mobileTitle="" /><Spinner /></>;

  const { project } = page;
  const view = project.view;
  const board = view.layout === "board" && !project.isInbox;
  const manual = view.sortMode === "manual";
  const canDrag = manual || board;
  const tasks = new Map(page.tasks.map((task) => [task.id, task]));
  const activeTasks = page.tasks.filter((task) => task.status === "active").length;
  const archived = project.status === "archived";
  const dragActive = drag ? tasks.get(drag.activeId) : undefined;

  const onDragStart = (event: DragStartEvent) => {
    listenPointer(true);
    setDrag({ activeId: String(event.active.id), over: null, plan: null });
  };
  const onDragMove = (event: DragMoveEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    let over: DropOver | null = null;
    if (overId?.startsWith("task:")) {
      // Mede o alvo no DOM agora: os retângulos da biblioteca podem estar defasados pela rolagem automática.
      const live = document.querySelector(`[data-task-id="${overId.slice(5)}"]`)?.getBoundingClientRect();
      const rect = live ?? event.over!.rect;
      const ratio = (pointerY(event) - rect.top) / Math.max(rect.height, 1);
      const zone: Zone = ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "center";
      over = { kind: "task", id: overId.slice(5), zone };
    } else if (overId?.startsWith("group:")) {
      const raw = overId.slice(6);
      over = { kind: "group", sectionId: raw === "none" ? null : raw };
    }
    const plan = over ? resolveDrop(page, String(event.active.id), over, board ? "board" : "list") : null;
    setDrag((current) => {
      if (!current) return current;
      if (JSON.stringify(current.over) === JSON.stringify(over)) return current;
      return { ...current, over, plan };
    });
  };
  // A prévia some ao soltar; o item real desliza de onde ela estava até o lugar final (motion.tsx).
  const settleFromOverlay = () => {
    if (drag) flipFrom(drag.activeId, document.querySelector(".drag-overlay")?.getBoundingClientRect());
  };
  const onDragEnd = () => {
    listenPointer(false);
    settleFromOverlay();
    const state = drag;
    setDrag(null);
    if (!state) return;
    if (!state.over) {
      toast("Arraste cancelado — a tarefa voltou ao lugar");
      return;
    }
    if (!state.plan) return;
    if (!state.plan.valid) {
      toast(`Destino inválido: ${state.plan.message.toLowerCase()}. A tarefa voltou ao lugar.`, { bad: true });
      return;
    }
    void execute(state.activeId, state.plan);
  };
  const onDragCancel = () => {
    listenPointer(false);
    settleFromOverlay();
    setDrag(null);
    toast("Arraste cancelado — a tarefa voltou ao lugar");
  };

  const indicator = drag?.plan?.indicator;
  const sectionMenu = (sectionId: string): MenuItem[] => {
    const section = page.sections.find((item) => item.id === sectionId)!;
    const index = page.sections.indexOf(section);
    const move = (anchor: { afterSectionId?: string; beforeSectionId?: string }) =>
      app.run(() => api.sections.move(section.id, section.revision, anchor), { success: "Seção reordenada" });
    return [
      { label: "Renomear", icon: <IconEdit />, onSelect: async () => {
        const name = await app.prompt({ title: "Renomear seção", label: "Nome da seção", initial: section.name, confirmLabel: "Salvar" });
        if (name && name !== section.name) await app.run(() => api.sections.rename(section.id, section.revision, name), { success: "Seção renomeada" });
      } },
      { label: board ? "Mover para a esquerda" : "Mover para cima", icon: <IconArrowUp />, disabled: index === 0,
        onSelect: () => void move({ beforeSectionId: page.sections[index - 1]?.id }) },
      { label: board ? "Mover para a direita" : "Mover para baixo", icon: <IconArrowDown />, disabled: index === page.sections.length - 1,
        onSelect: () => void move({ afterSectionId: page.sections[index + 1]?.id }) },
      "separator",
      { label: "Excluir seção…", icon: <IconTrash />, danger: true, onSelect: async () => {
        const ok = await app.confirm({
          title: `Excluir a seção “${section.name}”?`,
          body: section.taskCount
            ? `${section.taskCount} ${section.taskCount === 1 ? "tarefa vai" : "tarefas vão"} para o fim de “Sem seção”, com subtarefas, etiquetas e estados preservados.`
            : "A seção está vazia.",
          confirmLabel: "Excluir seção", danger: true,
        });
        if (ok) await app.run(() => api.sections.remove(section.id, section.revision), { success: "Seção excluída" });
      } },
    ];
  };

  const projectMenu = (): MenuItem[] => [
    { label: "Renomear projeto", icon: <IconEdit />, onSelect: async () => {
      const name = await app.prompt({ title: "Renomear projeto", label: "Nome do projeto", initial: project.name, confirmLabel: "Salvar" });
      if (name && name !== project.name) await app.run(() => api.projects.rename(project.id, project.revision, name), { success: "Projeto renomeado" });
    } },
    archived
      ? { label: "Reativar projeto", icon: <IconArchive />, onSelect: () => void app.run(() => api.projects.unarchive(project.id, project.revision), { success: "Projeto reativado" }) }
      : { label: "Arquivar projeto", icon: <IconArchive />, onSelect: async () => {
        const ok = await app.confirm({
          title: `Arquivar “${project.name}”?`,
          body: "O projeto sai das listas, da busca e da agenda, com tarefas e estados guardados. Você pode reativar em Ajustes.",
          confirmLabel: "Arquivar",
        });
        if (ok && await app.run(() => api.projects.archive(project.id, project.revision), { success: "Projeto arquivado" })) router.push("/hoje");
      } },
    "separator",
    { label: "Excluir projeto…", icon: <IconTrash />, danger: true, onSelect: async () => {
      const ok = await app.confirm({
        title: `Excluir “${project.name}”?`,
        body: "Só projetos sem tarefas, ativas ou concluídas, podem ser excluídos. Seções vazias vão junto.",
        confirmLabel: "Excluir projeto", danger: true,
      });
      if (!ok) return;
      try {
        await api.projects.remove(project.id, project.revision);
        toast("Projeto excluído");
        await invalidate();
        router.push("/hoje");
      } catch (error) {
        toast(error instanceof ApiFailure && error.code === "PROJECT_NOT_EMPTY"
          ? "O projeto ainda tem tarefas. Arquive-o ou mova as tarefas antes." : errorMessage(error), { bad: true });
      }
    } },
  ];

  const renderTask = (task: TaskItem, variant: "row" | "card") => (
    <DraggableTask
      key={task.id}
      task={task}
      variant={variant}
      disabled={!canDrag || archived || task.status !== "active" || (!manual && (!board || !!task.parentId))}
      dragging={drag?.activeId === task.id}
      indicator={indicator}
      draggedTitle={dragActive?.title}
      actions={actions}
      arrange={archived ? [] : menuActions(page, task.id)}
      onArrange={(action) => arrange(task.id, action)}
      onKeyArrange={onKeyArrange(task)}
      insert={manual && !archived ? (side) => startCreate(insertKey(side, task.id), insertDefaults(task, side)) : undefined}
      grip={canDrag && !archived && task.status === "active"}
    />
  );

  const crumb = project.isInbox ? "Captura e triagem" : <>Meus projetos <span aria-hidden="true">/</span></>;
  const tools = (
    <>
      {!archived && <ViewMenu page={page} onChange={(patch) => void changeView(patch)} />}
      {!project.isInbox && (
        <MenuButton label="Ações do projeto" title={project.name} items={projectMenu}><IconMore /></MenuButton>
      )}
    </>
  );

  return (
    <>
      <PageHeader crumb={crumb} tools={tools} mobileTitle={project.name} back={project.isInbox ? undefined : "/navegar"} />
      <div style={{ padding: "4px 32px 0" }} className="project-head">
        <div className={board ? "" : "col"}>
          <div className="page-h">
            <h1 className="title">{project.name}</h1>
            <span className="sub">
              {activeTasks} {activeTasks === 1 ? "tarefa" : "tarefas"}
              {!project.isInbox && ` · ${LAYOUT_LABEL[board ? "board" : "list"]}`} · {SORT_LABEL[view.sortMode]}
            </span>
          </div>
          <Collapse open={archived} appear={false}>
            <div className="banner warn">
              Projeto arquivado: só leitura. Reative para editar.
              <button type="button" className="btn ghost" style={{ marginLeft: "auto", height: 30, color: "var(--brand-text)" }}
                onClick={() => void app.run(() => api.projects.unarchive(project.id, project.revision), { success: "Projeto reativado" })}>Reativar</button>
            </div>
          </Collapse>
          <Collapse open={!manual && !archived} appear={false}>
            <div className="banner warn">
              <IconBan style={{ width: 16, height: 16, color: "var(--p2)" }} />
              <span style={{ flex: 1 }}>
                Ordenação por {SORT_LABEL[view.sortMode].toLowerCase()}: reordenar por posição está desativado.
                {board ? " Ainda dá para arrastar entre colunas e criar subtarefas." : " Use o menu ⋯ para mudar de seção."}
              </span>
              <button type="button" className="btn ghost" style={{ height: 30, color: "var(--brand-text)" }} onClick={() => void changeView({ sortMode: "manual" })}>
                Voltar a Manual
              </button>
            </div>
          </Collapse>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragMove={onDragMove}
        autoScroll={{ threshold: { x: 0.1, y: 0.1 }, acceleration: 8 }}
        onDragEnd={onDragEnd} onDragCancel={onDragCancel}
        accessibility={{ screenReaderInstructions: { draggable: "Para mover sem arrastar, use Alt e as setas ou o menu de ações da tarefa." } }}>
        {board
          ? <BoardLayout page={page} tasks={tasks} renderTask={renderTask} indicator={indicator} dragging={!!drag}
            mobile={mobile} sectionMenu={sectionMenu} archived={archived} />
          : <ListLayout page={page} tasks={tasks} renderTask={renderTask} indicator={indicator} dragging={!!drag}
            sectionMenu={sectionMenu} archived={archived} />}
        <DragOverlay dropAnimation={null}>
          {dragActive && (
            <div className="drag-overlay" style={{ width: board ? 280 : undefined }}>
              <TaskRow task={dragActive} actions={actions} variant={board ? "card" : "row"} noMenu extraClass="is-dragging" style={{ paddingLeft: 10 }} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {actions.moveDialog}
    </>
  );
}

/** Onde a tarefa criada por "Adicionar tarefa acima/abaixo" entra: mesmo grupo, ao lado da tarefa. */
function insertDefaults(task: TaskItem, side: InsertSide) {
  return {
    projectId: task.projectId, sectionId: task.sectionId, parentId: task.parentId,
    ...(side === "above" ? { beforeId: task.id } : { afterId: task.id }),
  };
}

/** Editor de "Adicionar tarefa abaixo"; numa tarefa com subtarefas na lista, aparece depois delas. */
function BelowSlot({ task }: { task: TaskItem }) {
  return <CreateSlot slot={insertKey("below", task.id)} defaults={insertDefaults(task, "below")} />;
}

function DraggableTask({
  task, variant, disabled, dragging, indicator, draggedTitle, actions, arrange, onArrange, onKeyArrange, insert, grip,
}: {
  task: TaskItem;
  variant: "row" | "card";
  disabled: boolean;
  dragging: boolean;
  indicator: Plan["indicator"] | undefined;
  draggedTitle?: string;
  actions: ReturnType<typeof useTaskActions>;
  arrange: ArrangeItem[];
  onArrange: (action: ArrangeItem["action"]) => void;
  onKeyArrange: (event: KeyboardEvent<HTMLDivElement>) => void;
  insert?: (side: InsertSide) => void;
  grip: boolean;
}) {
  // Em edição a linha vira formulário: arrastar a partir dos campos selecionaria texto e moveria a tarefa.
  const editing = useEditorOpen(editKey(task));
  const draggable = useDraggable({ id: task.id, disabled: disabled || editing });
  const droppable = useDroppable({ id: `task:${task.id}`, disabled: task.status !== "active" });
  const setRef = (node: HTMLDivElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };
  const nest = indicator?.type === "nest" && indicator.id === task.id;
  const bad = indicator?.type === "invalid" && indicator.id === task.id;
  const line = indicator?.type === "line" && indicator.id === task.id ? indicator : null;
  const preview = indicator?.type === "nest" && indicator.previewAfterId === task.id;
  const classes = [dragging ? "drag-src" : "", nest ? "nest-target" : "", bad ? "invalid" : ""].filter(Boolean).join(" ");
  const tag = nest ? <span className="nest-tag"><IconSub />Tornar subtarefa</span>
    : bad ? <span className="bad-tag"><IconBan />{indicator.message}</span> : null;
  const insStyle = variant === "card" ? { margin: "-5px 2px 7px" } : { marginLeft: line?.indent ? 34 : 0 };
  return (
    <Fragment>
      <CreateSlot slot={insertKey("above", task.id)} defaults={insertDefaults(task, "above")} />
      {line?.side === "before" && <div className="ins" style={insStyle} aria-hidden="true" />}
      <TaskRow
        ref={setRef}
        task={task}
        actions={actions}
        variant={variant}
        tag={variant === "row" ? tag : undefined}
        extraClass={classes}
        arrange={arrange}
        onArrange={onArrange}
        onKeyArrange={onKeyArrange}
        insert={insert}
        grip={grip && !editing}
        {...draggable.attributes}
        {...draggable.listeners}
        role={undefined}
        tabIndex={undefined}
        aria-disabled={undefined}
        aria-pressed={undefined}
        aria-roledescription={undefined}
        aria-describedby={undefined}
        style={{ touchAction: disabled ? undefined : "manipulation" }}
      />
      {variant === "card" && tag && <div style={{ margin: "-4px 0 8px" }}>{tag}</div>}
      {preview && draggedTitle && (
        <div className="nest-preview" style={{ margin: variant === "card" ? "-2px 0 8px 22px" : "4px 0 4px 34px" }} aria-hidden="true">
          <span className="ring p4" />{draggedTitle}
        </div>
      )}
      {line?.side === "after" && <div className="ins" style={insStyle} aria-hidden="true" />}
      {!(variant === "row" && task.childIds.length) && <BelowSlot task={task} />}
    </Fragment>
  );
}

function GroupDrop({ sectionId, className, children, label, as = "section", id }: {
  sectionId: string | null; className: string; children: ReactNode; label: string; as?: "section" | "div"; id?: string;
}) {
  const { setNodeRef } = useDroppable({ id: GROUP(sectionId) });
  const Tag = as;
  return <Tag ref={setNodeRef} id={id} className={className} aria-label={label}>{children}</Tag>;
}

type LayoutProps = {
  page: ProjectPage;
  tasks: Map<string, TaskItem>;
  renderTask: (task: TaskItem, variant: "row" | "card") => ReactNode;
  indicator: Plan["indicator"] | undefined;
  dragging: boolean;
  sectionMenu: (sectionId: string) => MenuItem[];
  archived: boolean;
};

function rowsOf(page: ProjectPage, tasks: Map<string, TaskItem>, sectionId: string | null) {
  const roots = (page.groups.find((group) => group.sectionId === sectionId)?.rootIds ?? [])
    .map((id) => tasks.get(id)).filter((task): task is TaskItem => !!task);
  return { active: roots.filter((task) => task.status === "active"), done: roots.filter((task) => task.status === "completed") };
}

function ListLayout({ page, tasks, renderTask, indicator, dragging, sectionMenu, archived }: LayoutProps) {
  const app = useApp();
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  const { project } = page;
  const block = (task: TaskItem) => [
    renderTask(task, "row"),
    ...task.childIds.map((id) => tasks.get(id)).filter((child): child is TaskItem => !!child).map((child) => renderTask(child, "row")),
    ...(task.childIds.length ? [<BelowSlot key={`below:${task.id}`} task={task} />] : []),
  ];

  const createSection = async (afterSectionId: string | null, name: string) => {
    const anchor = afterSectionId ? { afterSectionId } : page.sections[0] ? { beforeSectionId: page.sections[0].id } : {};
    await app.run(() => api.sections.create(project.id, name, anchor), { success: `Seção “${name}” criada` });
    setAdding(undefined);
  };

  return (
    <div className="content">
      <div className="col">
        {page.groups.map((group) => {
          const { active, done } = rowsOf(page, tasks, group.sectionId);
          const isNone = group.sectionId === null;
          const showHeader = !project.isInbox && (!isNone || active.length + done.length > 0);
          const over = indicator?.type === "group" && indicator.sectionId === group.sectionId;
          const badGroup = indicator?.type === "invalid" && indicator.sectionId === group.sectionId && indicator.id === undefined;
          const title = sectionName(page, group.sectionId);
          if (isNone && !showHeader && !project.isInbox && !dragging && page.sections.length) {
            return <GroupDrop key="none" sectionId={null} className="list-group" label="Sem seção"><span /></GroupDrop>;
          }
          return (
            <GroupDrop key={group.sectionId ?? "none"} sectionId={group.sectionId} label={title}
              className={`list-group${over ? " over" : ""}${badGroup ? " invalid" : ""}`}>
              {showHeader || (isNone && dragging && !project.isInbox) ? (
                <div className="sec-h" data-flip={`sec:${group.sectionId ?? "none"}`} style={{ color: isNone ? "var(--muted)" : undefined }}>
                  {title}<span className="count">{active.length + active.reduce((sum, task) => sum + task.childIds.filter((id) => tasks.get(id)?.status === "active").length, 0)}</span>
                  {!isNone && !archived && (
                    <MenuButton label={`Ações da seção ${title}`} title={title} items={() => sectionMenu(group.sectionId!)}><IconMore /></MenuButton>
                  )}
                </div>
              ) : <div style={{ height: 10, borderBottom: "1px solid var(--border)" }} />}
              {active.flatMap(block)}
              {!archived && (
                <AddTaskSlot slot={`add:${project.id}:${group.sectionId ?? "none"}`} defaults={{ projectId: project.id, sectionId: group.sectionId }}>
                  {(start) => (
                    <button type="button" className="add-task" data-flip={`add:${group.sectionId ?? "none"}`} onClick={start}>
                      <span className="plus"><IconPlus /></span>Adicionar tarefa
                    </button>
                  )}
                </AddTaskSlot>
              )}
              {done.length > 0 && (
                <>
                  <div className="sec-h" data-flip={`done:${group.sectionId ?? "none"}`} style={{ color: "var(--muted)", fontSize: 13, paddingTop: 12 }}>Concluídas<span className="count">{done.length}</span></div>
                  {done.flatMap(block)}
                </>
              )}
              {!project.isInbox && !archived && (
                adding === group.sectionId
                  ? <NewSection onCancel={() => setAdding(undefined)} onCreate={(name) => createSection(group.sectionId, name)} />
                  : (
                    <div className="add-sec-zone desktop-only" data-flip={`add-sec:${group.sectionId ?? "none"}`}>
                      <button type="button" className="add-sec" onClick={() => setAdding(group.sectionId)}>Adicionar seção</button>
                    </div>
                  )
              )}
            </GroupDrop>
          );
        })}
        {!project.isInbox && !archived && (
          <div className="mobile-only" style={{ paddingTop: 12 }}>
            {adding === "end"
              ? <NewSection onCancel={() => setAdding(undefined)} onCreate={(name) => createSection(page.sections.at(-1)?.id ?? null, name)} />
              : <button type="button" className="add-sec-m" onClick={() => setAdding("end")}><IconPlus className="plus" />Adicionar seção</button>}
          </div>
        )}
        {page.tasks.length === 0 && (
          <div className="empty">
            <strong>{project.isInbox ? "Caixa de entrada vazia" : "Nenhuma tarefa ainda"}</strong>
            {project.isInbox ? "Capture qualquer coisa com Q ou com o botão +." : "Adicione tarefas e organize em seções."}
          </div>
        )}
      </div>
    </div>
  );
}

function NewSection({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  return (
    <form className="sec-edit" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onCreate(name.trim()); }}>
      <label htmlFor="new-section" className="sr-only">Nome da nova seção</label>
      <input id="new-section" className="inline-input" placeholder="Nome da seção" value={name} autoFocus maxLength={120}
        onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }} />
      <button type="submit" className="btn primary" disabled={!name.trim()}>Adicionar</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>
    </form>
  );
}

function BoardLayout({ page, tasks, renderTask, indicator, dragging, sectionMenu, archived, mobile }: LayoutProps & { mobile: boolean }) {
  const app = useApp();
  const { project } = page;
  const columns = page.groups.filter((group) => group.sectionId !== null || dragging
    || (group.rootIds.length > 0) || page.sections.length === 0);
  const scrollTo = (sectionId: string | null) => {
    document.getElementById(`col-${sectionId ?? "none"}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };
  const newSection = async () => {
    const name = await app.prompt({ title: "Nova seção", label: "Nome da seção", confirmLabel: "Adicionar seção" });
    if (name) await app.run(() => api.sections.create(project.id, name), { success: `Seção “${name}” criada` });
  };
  return (
    <>
      {mobile && (
        <div className="col-tabs" role="tablist" aria-label="Colunas">
          {columns.map((group) => {
            const { active } = rowsOf(page, tasks, group.sectionId);
            return (
              <button key={group.sectionId ?? "none"} type="button" role="tab" aria-selected={false} className="pill" onClick={() => scrollTo(group.sectionId)}>
                {sectionName(page, group.sectionId)} · {active.length}
              </button>
            );
          })}
        </div>
      )}
      <div className="board">
        {columns.map((group) => {
          const { active, done } = rowsOf(page, tasks, group.sectionId);
          const title = sectionName(page, group.sectionId);
          const target = indicator?.type === "group" && indicator.sectionId === group.sectionId;
          const bad = indicator?.type === "invalid" && indicator.sectionId === group.sectionId && indicator.id === undefined;
          return (
            <Fragment key={group.sectionId ?? "none"}>
              <GroupDrop sectionId={group.sectionId} as="section" label={`Coluna ${title}`} id={`col-${group.sectionId ?? "none"}`}
                className={`column${target ? " target" : ""}${bad ? " invalid" : ""}`}>
                <div className="col-h" style={{ color: group.sectionId === null ? "var(--muted)" : undefined }}>
                  {title}<span className="count">{active.length}</span>
                  {group.sectionId !== null && !archived && (
                    <MenuButton label={`Ações da seção ${title}`} title={title} items={() => sectionMenu(group.sectionId!)}><IconMore /></MenuButton>
                  )}
                </div>
                {active.map((task) => renderTask(task, "card"))}
                {target && <div className="slot column-drop">Soltar aqui muda para {title}</div>}
                {!archived && (
                  <AddTaskSlot slot={`add:${project.id}:${group.sectionId ?? "none"}`} defaults={{ projectId: project.id, sectionId: group.sectionId }}>
                    {(start) => (
                      <button type="button" className="col-add" data-flip={`col-add:${group.sectionId ?? "none"}`} onClick={start}>
                        <IconPlus className="plus" />Adicionar tarefa
                      </button>
                    )}
                  </AddTaskSlot>
                )}
                {done.length > 0 && (
                  <>
                    <div className="sub" data-flip={`col-done:${group.sectionId ?? "none"}`} style={{ padding: "10px 6px 6px", fontWeight: 600 }}>Concluídas · {done.length}</div>
                    {done.map((task) => renderTask(task, "card"))}
                  </>
                )}
              </GroupDrop>
            </Fragment>
          );
        })}
        {!archived && (
          <button type="button" className="col-new" onClick={() => void newSection()}>
            <IconPlus style={{ color: "var(--brand-text)" }} />Adicionar seção
          </button>
        )}
      </div>
    </>
  );
}

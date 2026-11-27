"use client";
import { useT } from "./language";
import { inSentence } from "../client/locale";

import {
  DndContext, DragOverlay, MeasuringStrategy, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable,
  useDroppable, useSensor, useSensors, type CollisionDetection, type DragMoveEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useRouter } from "../navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { api, ApiFailure, errorMessage } from "../client/api";
import { tagColor } from "../client/colors";
import { editKey, insertKey, useEditorOpen } from "../client/editor-store";
import { sidewaysScroll } from "../client/sideways-scroll";
import { getQueryData, invalidate, setQueryData, useQuery } from "../client/store";
import {
  keyboardPlan, maxOverviewDepth, menuActions, originSlot, resolveSlot, sectionName, slotRows, taskBranch, taskMap,
  unnamedColumnTitle, type KeyAction, type Plan, type Slot,
} from "../client/tree";
import { isTemporaryTask, moveTask } from "../client/task-mutations";
import type { NamedDetails, ProjectPage, Section, TaskItem } from "@feito/core/types";
import { taskAncestors } from "@feito/core/domain/task-tree";
import { refreshProjects, useApp } from "./app";
import { PageHeader, PageTaskCount } from "./chrome";
import { listenPointer, pointerX, pointerY, startX, useTouchScrollGuard } from "./drag-pointer";
import { Collapse, flipFrom, motionMs, refreshFlip } from "./motion";
import { IconArchive, IconArrowDown, IconArrowUp, IconBan, IconEdit, IconGlobe, IconMore, IconPlus, IconDownload, IconTrash, IconUpload } from "./icons";
import { useExportDialog, useImportDialog } from "./import-export-dialogs";
import { NamedDetailsForm, useProjectDetailsDialog } from "./named-details";
import { colorValue, Glyph } from "./project-style";
import { useTaskActions } from "./task-actions";
import { AddTaskSlot, CreateSlot, useStartCreate } from "./task-editor";
import { TaskRow, type ArrangeItem, type InsertSide } from "./task-row";
import { Dialog, MenuButton, ReadFallback, useAutoGrow, useContextMenu, useIsMobile, useIsPhone, useToast, type MenuItem } from "./ui";
import { ShareMenu, useProjectShare, type ProjectSharing } from "./share-menu";
import { SORT_LABEL, ViewMenu } from "./view-menu";
import { CalendarLayout } from "./project-calendar";
import { TableLayout } from "./project-table";

const groupKey = (sectionId: string | null) => sectionId ?? "none";
const GROUP = (sectionId: string | null) => `group:${groupKey(sectionId)}`;
const groupNode = (sectionId: string | null) => document.querySelector<HTMLElement>(`[data-drop-group="${groupKey(sectionId)}"]`);

/** Deslocamento horizontal que muda um nível durante o arraste (o mesmo dos subprojetos na barra lateral). */
const INDENT_STEP = 20;

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

type DragState = {
  activeId: string;
  /** Nível da tarefa quando o arraste começou. */
  depth: number;
  /** Distância do ponteiro até a borda esquerda da seção de origem, no início. */
  offset: number;
  /** Altura do espaço aberto onde a tarefa vai cair. */
  gap: number;
  slot: Slot | null;
  plan: Plan | null;
  /**
   * Falso até o primeiro movimento: a biblioteca mede a linha de origem ao começar o arraste (é dali que a prévia parte),
   * então ela só sai do fluxo, trocada pelo espaço aberto, depois dessa medida.
   */
  live: boolean;
};

export function ProjectView({ projectId, sharing }: { projectId: string; sharing?: ProjectSharing }) {
  const t = useT();
  const app = useApp();
  const projectDetails = useProjectDetailsDialog();
  const [sectionToEdit, setSectionToEdit] = useState<Section | null>(null);
  const toast = useToast();
  const router = useRouter();
  const mobile = useIsMobile();
  const phone = useIsPhone();
  const actions = useTaskActions();
  const startCreate = useStartCreate();
  const key = `project:${projectId}`;
  const query = useQuery<ProjectPage>(key, () => api.projects.get(projectId));
  const page = query.data?.project.id === projectId ? query.data : undefined;
  const contextMenu = useContextMenu(!!page && !page.project.isInbox);
  const projectContent = useRef<HTMLDivElement>(null);
  const projectTitle = useRef<HTMLDivElement>(null);
  const [titleAboveView, setTitleAboveView] = useState(false);
  const showCompactTitle = !!page && !page.project.isInbox;
  const projectStatus = page?.project.status;
  const [drag, setDrag] = useState<DragState | null>(null);
  const focusAfter = useRef<string | null>(null);
  const [importDialog, openImport] = useImportDialog();
  const [exportDialog, openExport] = useExportDialog();

  useEffect(() => {
    const title = projectTitle.current;
    if (!showCompactTitle || !title) return;
    const headerHeight = getComputedStyle(title).getPropertyValue("--mobile-header-height").trim();
    const observer = new IntersectionObserver(([entry]) => {
      setTitleAboveView(!!entry.rootBounds && !entry.isIntersecting && entry.boundingClientRect.bottom <= entry.rootBounds.top);
    }, {
      root: mobile ? null : projectContent.current,
      rootMargin: mobile ? `-${headerHeight} 0px 0px` : "0px",
    });
    observer.observe(title);
    return () => observer.disconnect();
  }, [mobile, projectId, projectStatus, showCompactTitle]);

  useEffect(() => {
    if (query.error instanceof ApiFailure && query.error.code === "NOT_FOUND") router.replace("/hoje");
  }, [query.error, router]);

  useEffect(() => {
    const id = focusAfter.current;
    if (!id || !page) return;
    const tasks = taskMap(page);
    const moved = tasks.get(id);
    if (!moved) return;
    for (const task of [moved, ...taskAncestors(moved, tasks)]) {
      const target = document.querySelector<HTMLElement>(`[data-task-id="${task.id}"] .t-click`);
      if (!target) continue;
      target.focus();
      focusAfter.current = null;
      break;
    }
  }, [page]);

  useTouchScrollGuard();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
  );

  const execute = useCallback((taskId: string, plan: Plan, focus = false) => {
    if (!plan.valid) {
      toast(plan.message, { bad: true });
      return;
    }
    const task = page?.tasks.find((item) => item.id === taskId);
    if (!task || isTemporaryTask(task.id)) return;
    if (plan.steps.some((step) => step.type === "position"
      && [step.parentId, step.beforeId, step.afterId].some((id) => id && isTemporaryTask(id)))) return;
    if (focus) focusAfter.current = taskId;
    return app.run(() => moveTask(app.taskContext, task, plan.steps));
  }, [app, page, toast]);

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
      revalidate: (cached) => cached === key,
      // A troca de layout já é visível na tela: só a ordenação avisa.
      success: patch.sortMode ? (patch.sortMode === "manual" ? t("Ordem manual recuperada") : t("Ordenado por {0}", [inSentence(t(SORT_LABEL[patch.sortMode]))]))
        : undefined,
    });
  };

  if (!page) return <><PageHeader mobileTitle="" /><ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} /></>;

  const { project } = page;
  const view = project.view;
  const board = view.layout === "board" && !project.isInbox;
  const calendar = view.layout === "calendar";
  // No celular a Tabela vira Lista, como no Todoist: as colunas não cabem na largura.
  const table = view.layout === "table" && !phone;
  const wide = board || calendar || table;
  const manual = view.sortMode === "manual";
  const canDrag = manual || board;
  const tasks = taskMap(page);
  const activeTasks = page.tasks.filter((task) => task.status === "active").length;
  const archived = project.status === "archived";
  const dragActive = drag ? tasks.get(drag.activeId) : undefined;

  const onDragStart = (event: DragStartEvent) => {
    listenPointer(true);
    const id = String(event.active.id);
    const task = tasks.get(id);
    const origin = originSlot(page, id, tasks);
    if (!task || !origin) return;
    const node = groupNode(task.sectionId)?.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
    const height = node ? node.getBoundingClientRect().height + (parseFloat(getComputedStyle(node).marginBottom) || 0) : 0;
    const left = groupNode(task.sectionId)?.getBoundingClientRect().left ?? 0;
    const result = resolveSlot(page, id, origin.sectionId, origin.index, origin.depth);
    setDrag({
      activeId: id, depth: origin.depth, offset: startX(event) - left, gap: height,
      slot: result?.slot ?? null, plan: result?.plan ?? null, live: false,
    });
  };
  const onDragMove = (event: DragMoveEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    if (!drag || !overId?.startsWith("group:")) return;
    const raw = overId.slice(6);
    const sectionId = raw === "none" ? null : raw;
    const group = groupNode(sectionId);
    if (!group) return;
    // Mede as linhas no DOM agora: o espaço aberto e a rolagem automática mudam as posições a cada passo.
    const y = pointerY(event);
    let index = 0;
    for (const row of slotRows(page, sectionId, drag.activeId, tasks)) {
      const rect = group.querySelector(`[data-task-id="${row.id}"]`)?.getBoundingClientRect();
      if (rect && rect.top + rect.height / 2 < y) index++;
    }
    // Arrastar para a direita, a partir de onde começou, pede um nível a mais: subtarefa da linha de cima.
    const shift = Math.round((pointerX(event) - group.getBoundingClientRect().left - drag.offset) / INDENT_STEP);
    const result = resolveSlot(page, drag.activeId, sectionId, index, drag.depth + shift);
    if (!result) return;
    setDrag((current) => {
      if (!current) return current;
      if (current.live && JSON.stringify([current.slot, current.plan]) === JSON.stringify([result.slot, result.plan])) return current;
      return { ...current, ...result, live: true };
    });
  };
  const settle = () => {
    listenPointer(false);
    // Os vizinhos estão afastados para abrir espaço: a animação depois de soltar parte daí.
    refreshFlip();
    if (drag) flipFrom(drag.activeId, document.querySelector<HTMLElement>(".drag-overlay"));
  };
  const onDragEnd = () => {
    settle();
    const state = drag;
    setDrag(null);
    if (!state) return;
    if (!state.slot) {
      toast(t("Arraste cancelado — a tarefa voltou ao lugar"));
      return;
    }
    if (!state.plan) return;
    if (!state.plan.valid) {
      toast(t("Destino inválido: {0}. A tarefa voltou ao lugar.", [state.plan.message.toLowerCase()]), { bad: true });
      return;
    }
    void execute(state.activeId, state.plan);
  };
  const onDragCancel = () => {
    settle();
    setDrag(null);
    toast(t("Arraste cancelado — a tarefa voltou ao lugar"));
  };

  const indicator = drag?.plan?.indicator;
  const moving = new Set(dragActive && drag?.live ? Array.from(taskBranch(dragActive, tasks), ({ task }) => task.id) : []);
  const movingSection = dragActive?.sectionId;
  // Seção destacada: para onde a tarefa vai quando sai da seção em que está.
  const step = drag?.plan?.valid ? drag.plan.steps[0] : undefined;
  const targetSection = step?.type === "position" && step.sectionId !== movingSection ? step.sectionId : undefined;
  const dropGap = (sectionId: string | null, afterId: string | null) => drag?.live && (
    <DropGap key={`gap:${afterId ?? groupKey(sectionId)}`} height={drag.gap} depth={drag.slot?.depth ?? 0}
      open={!!drag.slot && drag.slot.sectionId === sectionId && drag.slot.afterId === afterId}
      message={drag.plan && !drag.plan.valid ? drag.plan.message : undefined} />
  );
  const renameSection = async (sectionId: string | null, name: string | null) => {
    await app.run(async () => {
      if (sectionId === null) {
        const saved = await api.projects.edit(project.id, project.revision, { defaultSectionName: name });
        query.mutate((current) => current && current.project.revision <= saved.revision
          ? { ...current, project: { ...current.project, ...saved } }
          : current);
      } else {
        const section = page.sections.find((item) => item.id === sectionId);
        if (!section || !name) return;
        const saved = await api.sections.edit(section.id, section.revision, { name });
        query.mutate((current) => current && {
          ...current,
          sections: current.sections.map((item) => item.id === saved.id && item.revision <= saved.revision
            ? { ...item, name: saved.name, revision: saved.revision }
            : item),
        });
      }
    }, { revalidate: refreshProjects });
  };
  const sectionMenu = (sectionId: string): MenuItem[] => {
    const section = page.sections.find((item) => item.id === sectionId)!;
    const index = page.sections.indexOf(section);
    const move = (anchor: { afterSectionId?: string; beforeSectionId?: string }) =>
      app.run(() => api.sections.move(section.id, section.revision, anchor), { success: t("Seção reordenada"), revalidate: (cached) => cached === key });
    return [
      { label: t("Editar seção"), icon: <IconEdit />, onSelect: () => setSectionToEdit(section) },
      { label: board ? t("Mover para a esquerda") : t("Mover para cima"), icon: <IconArrowUp />, disabled: index === 0,
        onSelect: () => void move({ beforeSectionId: page.sections[index - 1]?.id }) },
      { label: board ? t("Mover para a direita") : t("Mover para baixo"), icon: <IconArrowDown />, disabled: index === page.sections.length - 1,
        onSelect: () => void move({ afterSectionId: page.sections[index + 1]?.id }) },
      "separator",
      { label: t("Excluir seção…"), icon: <IconTrash />, danger: true, onSelect: async () => {
        const ok = await app.confirm({
          title: t("Excluir a seção “{0}”?", [section.name]),
          body: section.taskCount
            ? t("{0} {1} para o fim de “{2}”, com subtarefas, etiquetas e estados preservados.", [section.taskCount, section.taskCount === 1 ? t("tarefa vai") : t("tarefas vão"), sectionName(page, null)])
            : t("A seção está vazia."),
          confirmLabel: t("Excluir seção"), danger: true,
        });
        if (ok) await app.run(() => api.sections.remove(section.id, section.revision), { success: t("Seção excluída"), revalidate: refreshProjects });
      } },
    ];
  };

  const projectMenu = (): MenuItem[] => [
    ...(archived ? [] : [{ label: t("Editar projeto"), icon: <IconEdit />, onSelect: () => projectDetails.edit(project) }]),
    ...(!app.browserTools || archived ? [] : [{ label: t("Importar…"), icon: <IconUpload />, onSelect: () => openImport({ id: project.id, name: project.name }) }]),
    ...(app.browserTools ? [{ label: t("Exportar…"), icon: <IconDownload />, onSelect: () => openExport({ id: project.id, name: project.name, activeCount: project.activeCount }) }] : []),
    archived
      ? { label: t("Reativar projeto"), icon: <IconArchive />, onSelect: () => void app.run(() => api.projects.unarchive(project.id, project.revision), { success: t("Projeto reativado"), revalidate: refreshProjects }) }
      : { label: t("Arquivar projeto"), icon: <IconArchive />, onSelect: async () => {
        const ok = await app.confirm({
          title: t("Arquivar “{0}”?", [project.name]),
          body: t("O projeto sai das listas, da busca e da agenda, com tarefas e estados guardados. Você pode reativar em Ajustes."),
          confirmLabel: t("Arquivar"),
        });
        if (ok && await app.run(() => api.projects.archive(project.id, project.revision), { success: t("Projeto arquivado"), revalidate: refreshProjects })) router.push("/hoje");
      } },
    "separator",
    { label: t("Excluir projeto…"), icon: <IconTrash />, danger: true, onSelect: async () => {
      const ok = await app.confirm({
        title: t("Excluir “{0}”?", [project.name]),
        body: t("Só projetos sem tarefas, ativas ou concluídas, podem ser excluídos. Seções vazias vão junto."),
        confirmLabel: t("Excluir projeto"), danger: true,
      });
      if (!ok) return;
      try {
        await api.projects.remove(project.id, project.revision);
        toast(t("Projeto excluído"));
        await invalidate(refreshProjects);
        router.push("/hoje");
      } catch (error) {
        toast(error instanceof ApiFailure && error.code === "PROJECT_NOT_EMPTY"
          ? t("O projeto ainda tem tarefas. Arquive-o ou mova as tarefas antes.") : errorMessage(error), { bad: true });
      }
    } },
  ];

  const renderTask = (task: TaskItem, variant: "row" | "card", depth: number) => (
    <DraggableTask
      key={task.id}
      task={task}
      variant={variant}
      depth={depth}
      disabled={!canDrag || archived || task.status !== "active"}
      hidden={moving.has(task.id)}
      source={drag?.activeId === task.id}
      after={moving.has(task.id) ? null : dropGap(task.sectionId, task.id)}
      actions={actions}
      arrange={archived ? [] : menuActions(page, task.id, tasks)}
      onArrange={(action) => arrange(task.id, action)}
      onKeyArrange={onKeyArrange(task)}
      insert={manual && !archived ? (side) => startCreate(insertKey(side, task.id), insertDefaults(task, side)) : undefined}
      grip={canDrag && !archived && task.status === "active"}
    />
  );

  const crumb = project.isInbox ? t("Captura e triagem") : <>{t("Meus projetos")}{" "}<span aria-hidden="true">/</span></>;
  const compactTitle = showCompactTitle && (
    <span className="compact-title" aria-hidden={!titleAboveView} data-tooltip={project.isInbox ? t("Entrada") : project.name} onContextMenu={contextMenu.onContextMenu}>
      <Glyph icon={project.icon} style={{ color: project.color ? colorValue(project.color) : tagColor(project.id) }} />
      <span>{project.isInbox ? t("Entrada") : project.name}</span>
    </span>
  );
  const tools = (visible: boolean) => (
    <>
      {!project.isInbox && <ShareMenu projectId={project.id} archived={archived} sharing={sharing} />}
      {!archived && <ViewMenu view={view} scope={project.isInbox ? "inbox" : "project"} onChange={(patch) => void changeView(patch)} />}
      {!project.isInbox && (
        <MenuButton label={t("Mais ações")} tooltip={t("Mais ações")} title={project.isInbox ? t("Entrada") : project.name} items={projectMenu} contextMenu={visible ? contextMenu : undefined}><IconMore /></MenuButton>
      )}
    </>
  );

  return (
    <>
      <PageHeader crumb={crumb} tools={tools(!mobile)} mobileTools={tools(mobile)} compactTitle={compactTitle}
        mobileTitle={project.isInbox ? t("Entrada") : undefined} back={project.isInbox ? undefined : "/navegar"} />
      {importDialog}
      {exportDialog}
      {projectDetails.dialog}
      <Dialog open={sectionToEdit !== null} onClose={() => setSectionToEdit(null)} title={t("Editar seção")}>
        {sectionToEdit && <div className="dialog-b">
          <NamedDetailsForm key={sectionToEdit.id} kind="seção" initial={sectionToEdit} inDialog submitLabel={t("Salvar")}
            onCancel={() => setSectionToEdit(null)} onSave={async (details) => {
              if (details.name === sectionToEdit.name && details.description === sectionToEdit.description
                || await app.run(() => api.sections.edit(sectionToEdit.id, sectionToEdit.revision, details), { success: t("Seção atualizada"), revalidate: refreshProjects })) {
                setSectionToEdit(null);
              }
            }} />
        </div>}
      </Dialog>
      <div className="project-content" ref={projectContent}>
        <div style={{ padding: "4px 32px 0" }} className="project-head">
          <div className={wide ? "" : "col"}>
            <div className="page-h" onContextMenu={contextMenu.onContextMenu}>
              <ProjectHeading key={project.id} project={project} titleRef={projectTitle} />
              <div className="page-meta">
                <PageTaskCount count={activeTasks} />
                {!project.isInbox && !archived && !sharing?.unavailable && <PublicBadge projectId={project.id} origin={sharing?.origin} />}
              </div>
            </div>
            <Collapse open={archived} appear={false}>
              <div className="banner warn">
                {t("Projeto arquivado: só leitura. Reative para editar.")}<button type="button" className="btn ghost" style={{ marginLeft: "auto", height: 30, color: "var(--brand-text)" }}
                  onClick={() => void app.run(() => api.projects.unarchive(project.id, project.revision), { success: t("Projeto reativado"), revalidate: refreshProjects })}>{t("Reativar")}</button>
              </div>
            </Collapse>
            <Collapse open={!manual && !archived && !calendar} appear={false}>
              <div className="banner warn">
                <IconBan style={{ width: 16, height: 16, color: "var(--p2)" }} />
                <span style={{ flex: 1 }}>
                  {t("Ordenação por")}{" "}{inSentence(t(SORT_LABEL[view.sortMode]))}{t(": reordenar por posição está desativado.")}{board ? t(" Ainda dá para arrastar entre colunas e criar subtarefas.") : t(" Use o menu ⋯ para mudar de seção.")}
                </span>
                <button type="button" className="btn ghost" style={{ height: 30, color: "var(--brand-text)" }} onClick={() => void changeView({ sortMode: "manual" })}>
                  {t("Voltar a Manual")}</button>
              </div>
            </Collapse>
          </div>
        </div>
        {calendar && <CalendarLayout page={page} actions={actions} archived={archived} mobile={mobile} />}
        {table && <TableLayout page={page} actions={actions} archived={archived} />}
        {!calendar && !table && <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragMove={onDragMove}
          autoScroll={{ threshold: { x: 0.1, y: 0.1 }, acceleration: 8, layoutShiftCompensation: false }}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragEnd={onDragEnd} onDragCancel={onDragCancel}
          accessibility={{ screenReaderInstructions: { draggable: t("Para mover sem arrastar, use Alt e as setas ou o menu de ações da tarefa.") } }}>
          {board
            ? <BoardLayout page={page} tasks={tasks} renderTask={renderTask} indicator={indicator} targetSection={targetSection}
              dropGap={dropGap} mobile={mobile} sectionMenu={sectionMenu} renameSection={renameSection} archived={archived} />
            : <ListLayout page={page} tasks={tasks} renderTask={renderTask} indicator={indicator} targetSection={targetSection}
              dropGap={dropGap} dragging={!!drag} sectionMenu={sectionMenu} renameSection={renameSection} archived={archived} />}
          <DragOverlay dropAnimation={null}>
            {dragActive && (
              <div className="drag-overlay" style={{ width: board ? 280 : undefined }}>
                <TaskRow task={dragActive} actions={actions} variant={board ? "card" : "row"} noMenu extraClass="is-dragging" style={{ paddingLeft: 10 }} />
              </div>
            )}
          </DragOverlay>
        </DndContext>}
      </div>
      {actions.moveDialog}
    </>
  );
}

/** Selo "Público" ao lado da contagem enquanto o link de compartilhamento está ativo. */
function PublicBadge({ projectId, origin }: { projectId: string; origin?: string }) {
  const t = useT();
  const share = useProjectShare(projectId, true, origin);
  if (!share.data?.enabled) return null;
  return <span className="pub-badge"><IconGlobe />{t("Público")}</span>;
}

/** Onde a tarefa criada por "Adicionar tarefa acima/abaixo" entra: mesmo grupo, ao lado da tarefa. */
function insertDefaults(task: TaskItem, side: InsertSide) {
  return {
    projectId: task.projectId, sectionId: task.sectionId, parentId: task.parentId,
    ...(side === "above" ? { beforeId: task.id } : { afterId: task.id }),
  };
}

/** Editor de "Adicionar tarefa abaixo"; numa tarefa com subtarefas na lista, aparece depois delas. */
function BelowSlot({ task, depth }: { task: TaskItem; depth: number }) {
  return <CreateSlot slot={insertKey("below", task.id)} defaults={insertDefaults(task, "below")} depth={depth} />;
}

function DraggableTask({
  task, variant, depth, disabled, hidden, source, after, actions, arrange, onArrange, onKeyArrange, insert, grip,
}: {
  task: TaskItem;
  variant: "row" | "card";
  depth: number;
  disabled: boolean;
  /** Linha do ramo em arraste: sai do fluxo enquanto o espaço aberto mostra onde vai cair. */
  hidden: boolean;
  /** Linha que começou o arraste: esmaecida até sair do fluxo no primeiro movimento. */
  source: boolean;
  /** Espaço que se abre logo depois desta linha durante o arraste. */
  after: ReactNode;
  actions: ReturnType<typeof useTaskActions>;
  arrange: ArrangeItem[];
  onArrange: (action: ArrangeItem["action"]) => void;
  onKeyArrange: (event: KeyboardEvent<HTMLDivElement>) => void;
  insert?: (side: InsertSide) => void;
  grip: boolean;
}) {
  // Em edição a linha vira formulário: arrastar a partir dos campos selecionaria texto e moveria a tarefa.
  const editing = useEditorOpen(editKey(task));
  const temporary = isTemporaryTask(task.id);
  const draggable = useDraggable({ id: task.id, disabled: disabled || editing || temporary });
  return (
    <Fragment>
      <CreateSlot slot={insertKey("above", task.id)} defaults={insertDefaults(task, "above")} depth={depth} />
      <TaskRow
        ref={draggable.setNodeRef}
        task={task}
        actions={actions}
        variant={variant}
        depth={depth}
        showMoreSubtasks={depth === maxOverviewDepth && task.childIds.length > 0}
        extraClass={hidden ? "drag-hidden" : source ? "drag-src" : ""}
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
      {after}
    </Fragment>
  );
}

/** Espaço entre linhas que se abre, com animação, onde a tarefa arrastada vai cair; a barra mostra o nível. */
function DropGap({ open, height, depth, message }: { open: boolean; height: number; depth: number; message?: string }) {
  return (
    <div className="drop-gap" data-open={open ? "" : undefined} style={{ "--drop-gap": `${height}px` } as CSSProperties} aria-hidden="true">
      <div className={`ins task-tree-inset${message ? " bad" : ""}`} style={{ "--task-depth": depth } as CSSProperties} />
      {open && message && <span className="bad-tag"><IconBan />{message}</span>}
    </div>
  );
}

function GroupDrop({ sectionId, className, children, label, as = "section", id }: {
  sectionId: string | null; className: string; children: ReactNode; label: string; as?: "section" | "div"; id?: string;
}) {
  const { setNodeRef } = useDroppable({ id: GROUP(sectionId) });
  const Tag = as;
  return <Tag ref={setNodeRef} id={id} className={className} aria-label={label} data-drop-group={groupKey(sectionId)}>{children}</Tag>;
}

type LayoutProps = {
  page: ProjectPage;
  tasks: Map<string, TaskItem>;
  renderTask: (task: TaskItem, variant: "row" | "card", depth: number) => ReactNode;
  indicator: Plan["indicator"] | undefined;
  /** Seção que recebe a tarefa arrastada de outra seção. */
  targetSection: string | null | undefined;
  /** Espaço do arraste logo depois de `afterId` (ou no topo da seção, com `null`). */
  dropGap: (sectionId: string | null, afterId: string | null) => ReactNode;
  sectionMenu: (sectionId: string) => MenuItem[];
  renameSection: (sectionId: string | null, name: string | null) => Promise<void>;
  archived: boolean;
};

function rowsOf(page: ProjectPage, tasks: Map<string, TaskItem>, sectionId: string | null) {
  const roots = (page.groups.find((group) => group.sectionId === sectionId)?.rootIds ?? [])
    .map((id) => tasks.get(id)).filter((task): task is TaskItem => !!task);
  return { active: roots.filter((task) => task.status === "active"), done: roots.filter((task) => task.status === "completed") };
}

function renderTaskBlock(
  task: TaskItem, variant: "row" | "card", tasks: LayoutProps["tasks"], renderTask: LayoutProps["renderTask"], depth = 0,
): ReactNode[] {
  return [
    renderTask(task, variant, depth),
    ...(depth < maxOverviewDepth ? task.childIds.flatMap((id) => {
      const child = tasks.get(id);
      return child ? renderTaskBlock(child, variant, tasks, renderTask, depth + 1) : [];
    }) : []),
    <BelowSlot key={`below:${task.id}`} task={task} depth={depth} />,
  ];
}

type ProjectHeadingField = keyof NamedDetails;

function ProjectHeading({ project, titleRef }: { project: ProjectPage["project"]; titleRef: Ref<HTMLDivElement> }) {
  const t = useT();
  const app = useApp();
  const [editing, setEditing] = useState<{ field: ProjectHeadingField; initial: string; value: string } | null>(null);
  const descriptionInput = useAutoGrow(editing?.field === "description" ? editing.value : "");
  const [pending, setPending] = useState<Partial<Record<ProjectHeadingField, { value: string }>>>({});
  const queue = useRef(Promise.resolve(project.revision));
  const titleButton = useRef<HTMLButtonElement>(null);
  const descriptionButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<ProjectHeadingField | null>(null);
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    (returnFocus.current === "name" ? titleButton : descriptionButton).current?.focus();
    returnFocus.current = null;
  }, [editing]);

  if (project.isInbox || project.status === "archived") {
    return <>
      <div ref={titleRef}><h1 className="title">{project.isInbox ? t("Entrada") : project.name}</h1></div>
      {!project.isInbox && project.description && <p className="project-description">{project.description}</p>}
    </>;
  }

  const displayValue = (field: ProjectHeadingField) => pending[field]?.value ?? project[field];
  const openEditor = (field: ProjectHeadingField) => {
    const value = displayValue(field);
    setEditing({ field, initial: value, value });
  };
  const commit = () => {
    if (!editing) return;
    setEditing(null);
    const { field, initial } = editing;
    const value = field === "name" ? editing.value.trim() : editing.value;
    if (value === initial || (field === "name" && !value)) return;

    const change = { value };
    setPending((current) => ({ ...current, [field]: change }));
    const key = `project:${project.id}`;
    // Usar a revisão mais recente se o outro campo acabou de ser salvo.
    queue.current = queue.current.then(async (lastRevision) => {
      const revision = Math.max(lastRevision, getQueryData<ProjectPage>(key)?.project.revision ?? project.revision);
      const saved = await app.run(async () => {
        const saved = await api.projects.edit(project.id, revision, { [field]: value });
        setQueryData<ProjectPage>(key, (current) => current && current.project.revision <= saved.revision
          ? { ...current, project: { ...current.project, ...saved } }
          : current);
        return saved;
      }, { revalidate: refreshProjects });
      setPending((current) => current[field] === change ? { ...current, [field]: undefined } : current);
      return saved?.revision ?? revision;
    });
  };
  const editorProps = editing && {
    value: editing.value,
    autoFocus: true,
    onBlur: commit,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setEditing({ ...editing, value: event.target.value });
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        returnFocus.current = editing.field;
        setEditing(null);
      } else if (event.key === "Enter" && editing.field === "name") {
        event.preventDefault();
        returnFocus.current = editing.field;
        event.currentTarget.blur();
      }
    },
  };
  const name = displayValue("name");
  const description = displayValue("description");
  return (
    <div className="project-heading-fields">
      <div ref={titleRef}>
        <h1 className={editing?.field === "name" ? "sr-only" : "title"}>
          {editing?.field === "name" ? name : (
            <button type="button" className="project-heading-field" ref={titleButton} onClick={() => openEditor("name")}
              aria-description={t("Editar título do projeto")}>
              {name}
            </button>
          )}
        </h1>
        {editing?.field === "name" && <input {...editorProps} ref={sidewaysScroll} className="project-heading-field project-heading-input title"
          aria-label={t("Nome do projeto")} maxLength={120} />}
      </div>
      {editing?.field === "description" ? (
        <textarea {...editorProps} ref={descriptionInput} className="project-heading-field project-heading-input project-description"
          aria-label={t("Descrição do projeto")} placeholder={t("Adicionar uma descrição")} rows={1} maxLength={10_000} />
      ) : (
        <button type="button" className="project-heading-field project-description" ref={descriptionButton}
          onClick={() => openEditor("description")} aria-label={description ? t("Editar descrição do projeto") : undefined}>
          {description || t("Adicionar uma descrição")}
        </button>
      )}
    </div>
  );
}

function SectionTitle({ sectionId, name, archived, renameSection }: {
  sectionId: string | null; name: string | null; archived: boolean; renameSection: LayoutProps["renameSection"];
}) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const title = name ?? t(unnamedColumnTitle);

  useEffect(() => {
    if (draft !== null || !returnFocus.current) return;
    button.current?.focus();
    returnFocus.current = false;
  }, [draft]);

  if (archived) return <span>{title}</span>;
  if (draft === null) {
    return <button type="button" className="section-title" ref={button} onClick={() => setDraft(name ?? "")}
      aria-description={t("Editar nome da seção")}>{title}</button>;
  }

  const commit = async () => {
    if (saving) return;
    const next = draft.trim() || (sectionId === null ? null : name);
    if (next !== name) {
      setSaving(true);
      await renameSection(sectionId, next);
      setSaving(false);
    }
    setDraft(null);
  };

  return <input ref={sidewaysScroll} className="section-title section-title-input" aria-label={t("Nome da seção")} autoFocus
    maxLength={120} value={draft} readOnly={saving} placeholder={name === null ? t(unnamedColumnTitle) : undefined}
    onChange={(event) => setDraft(event.target.value)} onBlur={() => {
      returnFocus.current = false;
      void commit();
    }} onKeyDown={(event) => {
      if (saving || event.nativeEvent.isComposing) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        returnFocus.current = true;
        setDraft(null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        returnFocus.current = true;
        void commit();
      }
    }} />;
}

function SectionHeader({ sectionId, name, count, archived, renameSection, sectionMenu, board }:
  Pick<LayoutProps, "archived" | "renameSection" | "sectionMenu"> & {
    sectionId: string | null; name: string | null; count: number; board?: boolean;
  }) {
  const t = useT();
  const showMenu = sectionId !== null && !archived;
  const contextMenu = useContextMenu(showMenu);
  const title = name ?? t(unnamedColumnTitle);
  return (
    <div className={board ? "col-h" : "sec-h"} data-flip={board ? undefined : `sec:${sectionId ?? "none"}`}
      style={name === null ? { color: "var(--muted)" } : undefined} onContextMenu={contextMenu.onContextMenu}>
      <SectionTitle sectionId={sectionId} name={name} archived={archived} renameSection={renameSection} />
      <span className="count">{count}</span>
      {showMenu && (
        <MenuButton label={t("Ações da seção {0}", [title])} title={title} items={() => sectionMenu(sectionId)} contextMenu={contextMenu}><IconMore /></MenuButton>
      )}
    </div>
  );
}

function ListLayout({ page, tasks, renderTask, targetSection, dropGap, dragging, sectionMenu, renameSection, archived }: LayoutProps & { dragging: boolean }) {
  const t = useT();
  const app = useApp();
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  const { project } = page;
  const block = (task: TaskItem) => renderTaskBlock(task, "row", tasks, renderTask);
  const activeCounts = new Map<string | null, number>();
  for (const task of tasks.values()) {
    if (task.status === "active") activeCounts.set(task.sectionId, (activeCounts.get(task.sectionId) ?? 0) + 1);
  }

  const createSection = async (afterSectionId: string | null, details: NamedDetails) => {
    const anchor = afterSectionId ? { afterSectionId } : page.sections[0] ? { beforeSectionId: page.sections[0].id } : {};
    if (await app.run(() => api.sections.create(project.id, details, anchor), { success: t("Seção “{0}” criada", [details.name]), revalidate: (cached) => cached === `project:${project.id}` })) {
      setAdding(undefined);
    }
  };

  return (
    <div className="content">
      <div className="col">
        {page.groups.map((group) => {
          const { active, done } = rowsOf(page, tasks, group.sectionId);
          const over = targetSection === group.sectionId;
          const section = page.sections.find((item) => item.id === group.sectionId);
          const title = section?.name ?? project.defaultSectionName;
          if (group.sectionId === null && !title && !project.isInbox && !dragging && page.sections.length
            && !active.length && !done.length) {
            return <GroupDrop key="none" sectionId={null} className="list-group" label={t("Tarefas do projeto")}><span /></GroupDrop>;
          }
          return (
            <GroupDrop key={group.sectionId ?? "none"} sectionId={group.sectionId} label={title ?? (project.isInbox ? t("Entrada") : t("Tarefas do projeto"))}
              className={`list-group${over ? " over" : ""}`}>
              {!project.isInbox && title ? (
                <SectionHeader sectionId={group.sectionId} name={title} count={activeCounts.get(group.sectionId) ?? 0}
                  archived={archived} renameSection={renameSection} sectionMenu={sectionMenu} />
              ) : <div style={{ height: 10, borderBottom: "1px solid var(--border)" }} />}
              {section?.description && <p className="section-description">{section.description}</p>}
              {dropGap(group.sectionId, null)}
              {active.flatMap(block)}
              {!archived && (
                <AddTaskSlot slot={`add:${project.id}:${group.sectionId ?? "none"}`} defaults={{ projectId: project.id, sectionId: group.sectionId }}>
                  {(start) => (
                    <button type="button" className="add-task" data-flip={`add:${group.sectionId ?? "none"}`} onClick={start}>
                      <span className="plus"><IconPlus /></span>{t("Adicionar tarefa")}</button>
                  )}
                </AddTaskSlot>
              )}
              {done.length > 0 && (
                <>
                  <div className="sec-h" data-flip={`done:${group.sectionId ?? "none"}`} style={{ color: "var(--muted)", fontSize: 13, paddingTop: 12 }}>{t("Concluídas")}<span className="count">{done.length}</span></div>
                  {done.flatMap(block)}
                </>
              )}
              {!project.isInbox && !archived && (
                adding === group.sectionId
                  ? <NamedDetailsForm kind="seção" submitLabel={t("Adicionar seção")} onCancel={() => setAdding(undefined)}
                    onSave={(details) => createSection(group.sectionId, details)} />
                  : (
                    <div className="add-sec-zone desktop-only" data-flip={`add-sec:${group.sectionId ?? "none"}`}>
                      <button type="button" className="add-sec" onClick={() => setAdding(group.sectionId)}>{t("Adicionar seção")}</button>
                    </div>
                  )
              )}
            </GroupDrop>
          );
        })}
        {!project.isInbox && !archived && (
          <div className="mobile-only" style={{ paddingTop: 12 }}>
            {adding === "end"
              ? <NamedDetailsForm kind="seção" submitLabel={t("Adicionar seção")} onCancel={() => setAdding(undefined)}
                onSave={(details) => createSection(page.sections.at(-1)?.id ?? null, details)} />
              : <button type="button" className="add-sec-m" onClick={() => setAdding("end")}><IconPlus className="plus" />{t("Adicionar seção")}</button>}
          </div>
        )}
        {page.tasks.length === 0 && (
          <div className="empty">
            <strong>{project.isInbox ? t("Entrada vazia") : t("Nenhuma tarefa ainda")}</strong>
            {project.isInbox ? t("Capture qualquer coisa com Q ou com o botão +.") : t("Adicione tarefas e organize em seções.")}
          </div>
        )}
      </div>
    </div>
  );
}

function BoardLayout({ page, tasks, renderTask, indicator, targetSection, dropGap, sectionMenu, renameSection, archived, mobile }: LayoutProps & { mobile: boolean }) {
  const t = useT();
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const { project } = page;
  const block = (task: TaskItem) => renderTaskBlock(task, "card", tasks, renderTask);
  const columnName = (sectionId: string | null) =>
    sectionId === null ? project.defaultSectionName : sectionName(page, sectionId);
  const scrollTo = (sectionId: string | null) => {
    const column = document.getElementById(`col-${sectionId ?? "none"}`);
    const board = column?.parentElement;
    if (!column || !board) return;
    board.scrollBy({
      left: column.getBoundingClientRect().left - board.getBoundingClientRect().left,
      behavior: motionMs("base") ? "smooth" : "instant",
    });
  };
  const createSection = async (details: NamedDetails) => {
    if (await app.run(() => api.sections.create(project.id, details), { success: t("Seção “{0}” criada", [details.name]), revalidate: (cached) => cached === `project:${project.id}` })) {
      setAdding(false);
    }
  };
  return (
    <>
      {mobile && (
        <div className="col-tabs" role="tablist" aria-label={t("Colunas")}>
          {page.groups.map((group) => {
            const { active } = rowsOf(page, tasks, group.sectionId);
            return (
              <button key={group.sectionId ?? "none"} type="button" role="tab" aria-selected={false} className="pill" onClick={() => scrollTo(group.sectionId)}>
                {columnName(group.sectionId) ?? t(unnamedColumnTitle)} · {active.length}
              </button>
            );
          })}
        </div>
      )}
      <div className="board">
        {page.groups.map((group) => {
          const { active, done } = rowsOf(page, tasks, group.sectionId);
          const name = columnName(group.sectionId);
          const title = name ?? t(unnamedColumnTitle);
          const description = page.sections.find((section) => section.id === group.sectionId)?.description;
          const target = targetSection === group.sectionId;
          // Na ordenação automática não há posição para mostrar: o aviso diz só a coluna.
          const columnDrop = target && indicator?.type === "group";
          return (
            <Fragment key={group.sectionId ?? "none"}>
              <GroupDrop sectionId={group.sectionId} as="section" label={t("Coluna {0}", [title])} id={`col-${group.sectionId ?? "none"}`}
                className={`column${target ? " target" : ""}`}>
                <SectionHeader board sectionId={group.sectionId} name={name} count={active.length}
                  archived={archived} renameSection={renameSection} sectionMenu={sectionMenu} />
                {description && <p className="section-description">{description}</p>}
                {dropGap(group.sectionId, null)}
                {active.flatMap(block)}
                {columnDrop && <div className="slot column-drop">{t("Soltar aqui muda para")}{" "}{title}</div>}
                {!archived && (
                  <AddTaskSlot slot={`add:${project.id}:${group.sectionId ?? "none"}`} defaults={{ projectId: project.id, sectionId: group.sectionId }}>
                    {(start) => (
                      <button type="button" className="col-add" data-flip={`col-add:${group.sectionId ?? "none"}`} onClick={start}>
                        <IconPlus className="plus" />{t("Adicionar tarefa")}</button>
                    )}
                  </AddTaskSlot>
                )}
                {done.length > 0 && (
                  <>
                    <div className="sub" data-flip={`col-done:${group.sectionId ?? "none"}`} style={{ padding: "10px 6px 6px", fontWeight: 600 }}>{t("Concluídas ·")}{" "}{done.length}</div>
                    {done.flatMap(block)}
                  </>
                )}
              </GroupDrop>
            </Fragment>
          );
        })}
        {!archived && (adding ? (
          <div className="col-new-editor">
            <NamedDetailsForm kind="seção" submitLabel={t("Adicionar seção")} onCancel={() => setAdding(false)} onSave={createSection} />
          </div>
        ) : (
          <button type="button" className="col-new" onClick={() => setAdding(true)}>
            <IconPlus style={{ color: "var(--brand-text)" }} />{t("Adicionar seção")}</button>
        ))}
      </div>
    </>
  );
}

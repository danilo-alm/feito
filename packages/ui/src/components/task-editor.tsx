"use client";
import { useT } from "./language";

// Editor rápido de tarefa: o mesmo formulário serve à edição em linha (no lugar da tarefa), à criação em linha
// (no lugar de "Adicionar tarefa") e ao diálogo de adicionar (Q, botão da barra lateral e celular).
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { api } from "../client/api";
import { composerText, recoverDraft, registerComposer, type DraftText } from "../client/composer";
import { tagColor } from "../client/colors";
import { dateLabel, dayOfMonth, dueTone } from "../client/dates";
import { closeEditor, currentEditor, editKey, insertKey, openEditor, useEditorOpen, type InsertDefaults } from "../client/editor-store";
import { useSidewaysScroll } from "../client/sideways-scroll";
import { cacheScope, getQueryData, useQuery } from "../client/store";
import { createTask, editTask, type MutationContext } from "../client/task-mutations";
import type { EditTask, Frequency, Label, Priority, ProjectPage, TaskDetail, TaskItem } from "@feito/core/types";
import { useApp } from "./app";
import {
  DueIcon, IconCalendar, IconCheck, IconChevronDown, IconClock, IconFlag, IconInbox, IconPlus, IconRepeat, IconSub, IconTag, IconX,
} from "./icons";
import { TaskDescription } from "./task-description";
import { ProjectGlyph } from "./project-style";
import { DatePicker, DestinationPicker, FREQUENCIES, LabelPicker, PriorityMenu, RepeatMenu, TimePicker, destinationLabel } from "./pickers";
import { MenuList, Popover, useIsMobile, type MenuItem } from "./ui";

export type TaskDraft = {
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  frequency: Frequency | null;
  priority: Priority;
  labelIds: string[];
  projectId: string;
  sectionId: string | null;
};

type Pop = "more" | "date" | "time" | "repeat" | "priority" | "labels" | "dest" | null;

export function draftFromDefaults(defaults: InsertDefaults, inboxId: string): TaskDraft {
  return {
    title: "", description: "", dueDate: defaults.dueDate ?? null, dueTime: null, frequency: null, priority: 4,
    labelIds: defaults.labelIds ?? [], projectId: defaults.projectId ?? inboxId, sectionId: defaults.sectionId ?? null,
  };
}

function draftFromTask(task: TaskItem): TaskDraft {
  return {
    title: task.title, description: task.descriptionExcerpt ?? "", dueDate: task.dueDate, dueTime: task.dueTime,
    frequency: task.recurrence?.frequency ?? null, priority: task.priority, labelIds: task.labels.map((label) => label.id),
    projectId: task.projectId, sectionId: task.sectionId,
  };
}

export function sectionNameOf(projectId: string, sectionId: string | null) {
  if (!sectionId) return null;
  return getQueryData<ProjectPage>(`project:${projectId}`)?.sections.find((section) => section.id === sectionId)?.name ?? null;
}

/** Cria a tarefa e, quando pedido, a posiciona antes ou depois de uma irmã. */
export function createFromDraft(draft: TaskDraft, place: { parentId?: string | null; beforeId?: string; afterId?: string }, context: MutationContext) {
  const { reference } = context;
  const parentId = place.parentId ?? null;
  return createTask(context, {
    title: draft.title,
    description: draft.description.trim() ? draft.description : undefined,
    ...(parentId ? { parentId } : { projectId: draft.projectId, sectionId: draft.sectionId }),
    priority: draft.priority,
    dueDate: draft.frequency ? draft.dueDate ?? reference : draft.dueDate,
    dueTime: draft.dueDate || draft.frequency ? draft.dueTime : null,
    labelIds: draft.labelIds,
    recurrence: draft.frequency && !parentId ? { frequency: draft.frequency, anchorDate: draft.dueDate ?? reference, time: draft.dueTime } : undefined,
    beforeId: place.beforeId,
    afterId: place.afterId,
  });
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((item) => b.includes(item));

/** Envia todas as mudanças da edição com a mesma revisão. */
async function saveEdits(task: TaskItem, before: TaskDraft, after: TaskDraft, fullDescription: string | undefined, context: MutationContext) {
  const patch: Omit<EditTask, "revision"> = {};
  if (after.title !== before.title) patch.title = after.title;
  if (fullDescription !== undefined && after.description !== fullDescription) patch.description = after.description;
  if (after.priority !== before.priority) patch.priority = after.priority;
  if (after.dueDate !== before.dueDate) patch.dueDate = after.dueDate;
  if (after.dueTime !== before.dueTime) patch.dueTime = after.dueTime;
  if (!sameSet(after.labelIds, before.labelIds)) patch.labelIds = after.labelIds;
  if (after.frequency !== before.frequency) {
    patch.recurrence = after.frequency
      ? { frequency: after.frequency, anchorDate: after.dueDate ?? context.reference, time: after.dueTime }
      : null;
  }
  if (!task.parentId && (after.projectId !== before.projectId || after.sectionId !== before.sectionId)) {
    patch.destination = { projectId: after.projectId, sectionId: after.sectionId };
  }
  if (!Object.keys(patch).length) return "unchanged" as const;
  await editTask(context, task, patch);
  return "saved" as const;
}

export function TaskEditor({
  initial, variant, parentTitle, canRepeat = true, lockDestination = false, lateDescription, submitLabel, resetOnSubmit = false,
  onSubmit, onCancel, titleRef, flipKey, hint,
}: {
  initial: TaskDraft;
  variant: "inline" | "dialog";
  parentTitle?: string;
  canRepeat?: boolean;
  lockDestination?: boolean;
  /** Descrição completa que chega depois (edição): `null` enquanto carrega. */
  lateDescription?: string | null;
  submitLabel: string;
  resetOnSubmit?: boolean;
  onSubmit: (draft: TaskDraft) => Promise<boolean>;
  onCancel: () => void;
  titleRef?: RefObject<HTMLInputElement | null>;
  flipKey?: string;
  hint?: ReactNode;
}) {
  const t = useT();
  const app = useApp();
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<TaskDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const [pop, setPop] = useState<Pop>(null);
  const [busy, setBusy] = useState(false);
  const anchors = useRef<Record<string, HTMLButtonElement | null>>({});
  const ownTitle = useRef<HTMLInputElement>(null);
  const title = titleRef ?? ownTitle;
  const titleField = useSidewaysScroll(title);
  const descTouched = useRef(false);
  const loadingDescription = lateDescription === null;
  const inline = variant === "inline";
  const latest = useRef(draft);
  latest.current = draft;

  // Criação: o editor aberto recebe de volta o texto de uma gravação que falhou (veja client/composer.ts).
  useEffect(() => {
    if (!resetOnSubmit) return;
    return registerComposer({
      read: () => ({ title: latest.current.title, description: latest.current.description }),
      write: (text) => {
        descTouched.current = !!text.description;
        latest.current = { ...latest.current, ...text };
        setDraft((current) => ({ ...current, ...text }));
        title.current?.focus();
      },
    });
  }, [resetOnSubmit, title]);

  useEffect(() => {
    if (typeof lateDescription === "string" && !descTouched.current) setDraft((current) => ({ ...current, description: lateDescription }));
  }, [lateDescription]);

  // Em linha: foco no título com o cursor no fim (o diálogo cuida do próprio foco inicial).
  useEffect(() => {
    if (!inline) return;
    const node = title.current;
    node?.focus();
    node?.setSelectionRange(node.value.length, node.value.length);
  }, [inline, title]);

  const submit = async () => {
    const text = draft.title.trim();
    if (!text || busy) return;
    if (resetOnSubmit) {
      // Otimista: o campo fica livre para a próxima tarefa e o texto enviado só volta se a gravação falhar.
      const scope = cacheScope();
      const sent: DraftText = { title: draft.title, description: draft.description };
      descTouched.current = false;
      latest.current = { ...latest.current, title: "", description: "" };
      set({ title: "", description: "" });
      title.current?.focus();
      const ok = await onSubmit({ ...draft, title: text }).catch(() => false);
      if (!ok && scope === cacheScope()) recoverDraft(sent);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ ...draft, title: text });
    } finally {
      setBusy(false);
    }
  };

  const labels = getQueryData<{ labels: Label[] }>("labels")?.labels ?? app.nav?.labels ?? [];
  const inboxId = app.nav?.inbox.projectId ?? app.me.inboxProjectId;
  const closePop = () => setPop(null);
  const anchorOf = (key: Exclude<Pop, null>) => anchors.current[key] ?? anchors.current.more ?? null;

  const chip = (key: Exclude<Pop, null>, content: ReactNode, active: boolean, label: string, className = "") => (
    <button type="button" ref={(node) => { anchors.current[key] = node; }} className={`pill${active ? " on" : ""} ${className}`}
      aria-haspopup={key === "more" ? "menu" : "dialog"} aria-expanded={pop === key} aria-label={label} data-tooltip={label}
      onClick={() => setPop(pop === key ? null : key)}>
      {content}
    </button>
  );

  const hasDate = !!draft.dueDate || !!draft.frequency;
  const moreItems: MenuItem[] = [
    ...(hasDate ? [{ label: draft.dueTime ? t("Horário · {0}", [draft.dueTime]) : t("Horário"), icon: <IconClock />, onSelect: () => setPop("time") }] : []),
    ...(canRepeat ? [{ label: t("Repetir"), icon: <IconRepeat />, onSelect: () => setPop("repeat") }] : []),
    { label: t("Etiquetas"), icon: <IconTag />, onSelect: () => setPop("labels") },
  ];
  const destination = (
    chip("dest", <>
      {draft.projectId === inboxId ? <IconInbox /> : <ProjectGlyph id={draft.projectId} className="te-hash" />}
      <span className="te-dest">{destinationLabel(app, draft.projectId, sectionNameOf(draft.projectId, draft.sectionId))}</span>
      <IconChevronDown className="sm" />
    </>, false, t("Projeto"))
  );

  const chips = (
    <div className="chips">
      {chip("more", <IconPlus />, false, t("Mais opções"), "te-plus")}
      {chip("date", <>{draft.dueDate
        ? <DueIcon tone={dueTone(draft.dueDate, app.reference)} day={dayOfMonth(draft.dueDate)} />
        : <IconCalendar />}{draft.dueDate ? dateLabel(draft.dueDate, app.reference) : t("Data")}</>, !!draft.dueDate, t("Data"),
        draft.dueDate ? `tone-${dueTone(draft.dueDate, app.reference)}` : "")}
      {hasDate && draft.dueTime && chip("time", <><IconClock />{draft.dueTime}</>, true, t("Horário"))}
      {draft.frequency && chip("repeat", <><IconRepeat />{t(FREQUENCIES.find((option) => option.value === draft.frequency)?.label ?? "").split(",")[0]}</>, true, t("Repetir"))}
      {chip("priority", <><IconFlag style={{ color: "var(--pc)" }} />{draft.priority < 4 ? `P${draft.priority}` : t("Prioridade")}</>,
        draft.priority < 4, t("Prioridade"), `p${draft.priority}`)}
      {draft.labelIds.length > 0 && chip("labels", <><IconTag style={{ color: tagColor(draft.labelIds[0]) }} />
        {draft.labelIds.map((labelId) => labels.find((label) => label.id === labelId)?.name ?? t("Etiqueta")).join(", ")}</>, true, t("Etiquetas"))}
      {inline && !lockDestination && destination}
    </div>
  );

  return (
    <form className={`t-editor te-${variant}`} data-flip={flipKey} aria-label={submitLabel}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
      onKeyDown={(event) => {
        if (inline && event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}>
      {parentTitle && <div className="crumb"><IconSub className="sm" />{t("Subtarefa de")}{" "}{parentTitle}</div>}
      <label htmlFor={`${id}-title`} className="sr-only">{t("Título da tarefa")}</label>
      <input id={`${id}-title`} ref={titleField} className={inline ? "te-title" : "qa-title"} placeholder={t("Nome da tarefa")} value={draft.title}
        maxLength={500} autoComplete="off" onChange={(event) => set({ title: event.target.value })} />
      <TaskDescription id={`${id}-desc`} className={inline ? "te-desc" : "qa-desc"} rows={1} maxLength={10_000}
        placeholder={loadingDescription ? t("Carregando descrição…") : t("Descrição")} readOnly={loadingDescription} value={draft.description}
        onValueChange={(description) => { descTouched.current = true; set({ description }); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }} />
      {inline ? (
        <div className="te-bar">
          {chips}
          <span className="te-actions">
            <button type="button" className="icon-btn" onClick={onCancel} aria-label={t("Cancelar (Esc)")} data-tooltip={t("Cancelar (Esc)")}><IconX /></button>
            <button type="submit" className="te-ok" disabled={!draft.title.trim() || busy} aria-label={submitLabel} data-tooltip={`${submitLabel} (Enter)`}>
              <IconCheck />
            </button>
          </span>
        </div>
      ) : (
        <>
          {chips}
          <div className="te-foot">
            {!lockDestination && destination}
            {hint}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn ghost" onClick={onCancel}>{t("Cancelar")}</button>
            <button type="submit" className="btn primary" disabled={!draft.title.trim() || busy}>{submitLabel}</button>
          </div>
        </>
      )}

      <Popover anchor={anchors.current.more ?? null} open={pop === "more"} onClose={closePop} label={t("Mais opções")} role="menu">
        <MenuList items={moreItems} onClose={closePop} />
      </Popover>
      <Popover anchor={anchors.current.date ?? null} open={pop === "date"} onClose={closePop} label={t("Data")}>
        <DatePicker value={draft.dueDate} reference={app.reference} onClose={closePop} allowClear={!draft.frequency}
          onPick={(date) => set(date ? { dueDate: date } : { dueDate: null, dueTime: null })} />
      </Popover>
      <Popover anchor={anchorOf("time")} open={pop === "time"} onClose={closePop} label={t("Horário")}>
        <TimePicker value={draft.dueTime} onPick={(time) => { set({ dueTime: time }); closePop(); }} />
      </Popover>
      <Popover anchor={anchorOf("repeat")} open={pop === "repeat"} onClose={closePop} label={t("Repetir")}>
        <RepeatMenu value={draft.frequency} onPick={(value) => {
          set(value && !draft.dueDate ? { frequency: value, dueDate: app.reference } : { frequency: value });
          closePop();
        }} />
      </Popover>
      <Popover anchor={anchors.current.priority ?? null} open={pop === "priority"} onClose={closePop} label={t("Prioridade")}>
        <PriorityMenu value={draft.priority} onPick={(value) => { set({ priority: value }); closePop(); }} />
      </Popover>
      <Popover anchor={anchorOf("labels")} open={pop === "labels"} onClose={closePop} label={t("Etiquetas")}>
        <LabelPicker selected={draft.labelIds} onChange={(update) => setDraft((current) => ({ ...current, labelIds: update(current.labelIds) }))} />
      </Popover>
      <Popover anchor={anchors.current.dest ?? null} open={pop === "dest"} onClose={closePop} label={t("Projeto")}>
        <DestinationPicker projectId={draft.projectId} sectionId={draft.sectionId}
          onPick={(projectId, sectionId) => { set({ projectId, sectionId }); closePop(); }} />
      </Popover>
    </form>
  );
}

/** Edição em linha, no lugar da tarefa. */
export function InlineEdit({ task }: { task: TaskItem }) {
  const t = useT();
  const app = useApp();
  const key = editKey(task);
  const detail = useQuery<TaskDetail>(`task:${task.id}`, () => api.tasks.get(task.id));
  const loaded = detail.data?.id === task.id ? detail.data : undefined;
  const [initial] = useState(() => draftFromTask(task));
  return (
    <TaskEditor
      variant="inline"
      flipKey={`editor:${key}`}
      initial={initial}
      lateDescription={loaded ? loaded.description : null}
      lockDestination={!!task.parentId}
      canRepeat={!task.parentId && task.subtasks.total === 0}
      submitLabel={t("Salvar")}
      onCancel={() => closeEditor(key)}
      onSubmit={async (draft) => {
        const saving = app.run(() => saveEdits(task, initial, draft, loaded?.description, app.taskContext), {
          success: (value) => (value === "saved" ? t("Tarefa atualizada") : ""),
        });
        closeEditor(key);
        return !!await saving;
      }}
    />
  );
}

/**
 * Criações "abaixo" em sequência: cada uma vai depois da anterior, mesmo enviada antes de a anterior ser confirmada.
 * Fica fora do componente porque o editor muda de lugar (e remonta) quando a sequência termina.
 */
const belowChains = new Map<string, { tail: Promise<string | undefined>; pending: number }>();

export function clearInlineCreateQueues() {
  belowChains.clear();
}

/** Criação em linha, no lugar de "Adicionar tarefa" ou acima/abaixo de uma tarefa. Fica aberta para a próxima. */
export function InlineCreate({ slot, defaults }: { slot: string; defaults: InsertDefaults }) {
  const t = useT();
  const app = useApp();
  const inboxId = app.nav?.inbox.projectId ?? app.me.inboxProjectId;
  const [initial] = useState(() => {
    const target = currentEditor();
    const carried = target?.kind === "create" && target.key === slot ? target.text : undefined;
    return { ...draftFromDefaults(defaults, inboxId), ...carried };
  });
  const parentId = defaults.parentId ?? null;
  return (
    <TaskEditor
      variant="inline"
      flipKey={`editor:${slot}`}
      initial={initial}
      lockDestination={!!parentId}
      canRepeat={!parentId}
      submitLabel={t("Adicionar tarefa")}
      resetOnSubmit
      onCancel={() => closeEditor(slot)}
      onSubmit={async (draft) => {
        const samePlace = draft.projectId === initial.projectId && draft.sectionId === initial.sectionId;
        const create = (afterId = samePlace ? defaults.afterId : undefined) => app.run(() => createFromDraft(draft, {
          parentId, ...(samePlace ? { beforeId: defaults.beforeId, afterId } : {}),
        }, app.taskContext), {
          // Fora do lugar onde o editor está, a tarefa não aparece aqui: o aviso diz para onde foi.
          success: samePlace ? undefined : t("Tarefa adicionada em {0}", [destinationLabel(app, draft.projectId, sectionNameOf(draft.projectId, draft.sectionId))]),
        });
        if (!samePlace || !defaults.afterId) return !!await create();

        // "Abaixo": a próxima vai depois desta; se esta falhar, a próxima fica onde esta iria.
        const chain = belowChains.get(slot) ?? { tail: Promise.resolve(defaults.afterId), pending: 0 };
        belowChains.set(slot, chain);
        chain.pending += 1;
        const scope = cacheScope();
        const attempt = chain.tail.then(async (afterId) => ({
          afterId, created: scope === cacheScope() ? await create(afterId) : undefined,
        }));
        chain.tail = attempt.then(({ afterId, created }) => created?.id ?? afterId);
        const { created } = await attempt;
        chain.pending -= 1;
        if (chain.pending) return !!created;
        if (belowChains.get(slot) === chain) belowChains.delete(slot);
        // Fim da sequência: o editor desce para depois da última tarefa criada, com o texto que já estiver nele.
        const target = currentEditor();
        if (scope === cacheScope() && created && target?.key === slot) {
          openEditor({
            kind: "create", key: insertKey("below", created.id), defaults: { ...defaults, afterId: created.id },
            text: composerText() ?? undefined,
          });
        }
        return !!created;
      }}
    />
  );
}

/** Abre a criação: em linha no desktop, no diálogo (folha) no celular. */
export function useStartCreate() {
  const app = useApp();
  const mobile = useIsMobile();
  return useCallback((slot: string, defaults: InsertDefaults) => {
    if (mobile) app.openQuickAdd(defaults);
    else openEditor({ kind: "create", key: slot, defaults });
  }, [app, mobile]);
}

/** Lugar onde a criação em linha aparece quando aberta por outro controle (ex.: "+" no título do dia). */
export function CreateSlot({ slot, defaults, depth = 0 }: { slot: string; defaults: InsertDefaults; depth?: number }) {
  const open = useEditorOpen(slot);
  if (!open) return null;
  const editor = <InlineCreate slot={slot} defaults={defaults} />;
  return depth ? <div className="task-tree-inset" style={{ "--task-depth": depth } as CSSProperties}>{editor}</div> : editor;
}

/** Botão "Adicionar tarefa" que vira o editor em linha no mesmo lugar. */
export function AddTaskSlot({ slot, defaults, children }: {
  slot: string; defaults: InsertDefaults; children: (start: () => void) => ReactNode;
}) {
  const open = useEditorOpen(slot);
  const start = useStartCreate();
  return open ? <InlineCreate slot={slot} defaults={defaults} /> : <>{children(() => start(slot, defaults))}</>;
}

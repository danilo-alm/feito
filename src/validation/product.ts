import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { PROJECT_COLORS, PROJECT_ICONS } from "./project-style";

export const entityId = z.uuid().transform((value) => value.toLowerCase());
export const revision = z.number().int().min(1).max(2147483647);
export const position = z.number().int().nonnegative();
function boundedText(schema: z.ZodString, max: number) {
  return schema.refine((value) => value.isWellFormed() && [...value].length <= max);
}

export const name = boundedText(z.string().trim().min(1), 120);
export const defaultSectionName = name.nullable().optional();
export const title = boundedText(z.string().trim().min(1), 500);
export const description = boundedText(z.string(), 10_000);
export const priority = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const civilDate = z.iso.date().refine((value) => {
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
});
export const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const instant = z.iso.datetime();
const frequency = z.enum(["daily", "weekly", "monthly"]);
const recurrenceInput = z.strictObject({
  frequency,
  anchorDate: civilDate.optional(),
  time: localTime.nullable().optional(),
});
export const recurrenceRule = z.strictObject({
  frequency,
  anchorDate: civilDate,
  time: localTime.nullable(),
  nominalDate: civilDate,
});

const recurrenceChange = z.strictObject({
  frequency,
  anchorDate: civilDate,
  time: localTime.nullable().optional(),
});
export const setRecurrenceInput = recurrenceChange.extend({ revision });

export const completedOccurrencePayload = z.strictObject({
  nominalDate: civilDate,
  dueDate: civilDate,
  dueTime: localTime.nullable(),
  completedAt: instant,
  nextOccurrenceId: entityId.optional(),
});

export const projectView = z.strictObject({
  layout: z.enum(["list", "board"]),
  sortMode: z.enum(["manual", "date", "priority"]),
  showCompleted: z.boolean(),
});
export const defaultsForView: z.infer<typeof projectView> = {
  layout: "list", sortMode: "manual", showCompleted: false,
};
export const projectColor = z.enum(PROJECT_COLORS);
export const projectIcon = z.enum(PROJECT_ICONS);
export const projectPayload = z.strictObject({
  name,
  defaultSectionName,
  description: description.default(""),
  color: projectColor.nullable().default(null),
  icon: projectIcon.default("hash"),
  archived: z.boolean(),
  view: projectView,
  createdAt: instant.default("1970-01-01T00:00:00Z"),
});
export const sectionPayload = z.strictObject({ name, description: description.default(""), position });
export const labelPayload = z.strictObject({ name });
export const taskPayload = z.strictObject({
  title,
  description,
  priority,
  position,
  createdAt: instant,
  completedAt: instant.nullable().default(null),
  dueDate: civilDate.nullable().default(null),
  dueTime: localTime.nullable().default(null),
  recurrenceRule: recurrenceRule.nullable().default(null),
}).refine((task) => task.dueTime === null || task.dueDate !== null);

export const nameInput = z.strictObject({ name });
export const editNameInput = z.strictObject({ name, revision });
export const createNamedDetailsInput = z.strictObject({ name, description: description.default("") });
export const editNamedDetailsInput = z.strictObject({ revision, name: name.optional(), description: description.optional() })
  .refine((input) => input.name !== undefined || input.description !== undefined);
export const createProjectInput = createNamedDetailsInput.extend({
  color: projectColor.nullable().default(null),
  icon: projectIcon.default("hash"),
});
export const editProjectInput = z.strictObject({
  revision, name: name.optional(), description: description.optional(),
  defaultSectionName,
  color: projectColor.nullable().optional(), icon: projectIcon.optional(),
}).refine((input) => Object.keys(input).length > 1);
export const revisionInput = z.strictObject({ revision });
export const projectViewPatch = projectView.partial();
const queryBool = z.enum(["true", "false"]).transform((value) => value === "true");
const revisionQuery = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(revision);
export const projectListQuery = z.strictObject({ status: z.enum(["active", "archived"]).default("active") });
export const projectPageQuery = z.strictObject({ includeCompleted: queryBool.optional() });
export const deleteQuery = z.strictObject({ revision: revisionQuery });
export const taskDeleteQuery = deleteQuery.extend({ withChildren: queryBool.optional() });

const sectionAnchor = { afterSectionId: entityId.optional(), beforeSectionId: entityId.optional() };
const atMostOneSectionAnchor = (input: { afterSectionId?: string; beforeSectionId?: string }) =>
  !(input.afterSectionId && input.beforeSectionId);
export const createSectionInput = createNamedDetailsInput.extend(sectionAnchor)
  .refine(atMostOneSectionAnchor, { path: ["beforeSectionId"] });
export const sectionMoveInput = z.strictObject({ revision, ...sectionAnchor })
  .refine(atMostOneSectionAnchor, { path: ["beforeSectionId"] });

const taskFields = {
  title: title.optional(),
  description: description.optional(),
  priority: priority.optional(),
  dueDate: civilDate.nullable().optional(),
  dueTime: localTime.nullable().optional(),
  labelIds: z.array(entityId).optional(),
};
export const createTaskInput = z.strictObject({
  ...taskFields,
  title,
  projectId: entityId.optional(),
  sectionId: entityId.nullable().optional(),
  parentId: entityId.nullable().optional(),
  recurrence: recurrenceInput.nullable().optional(),
  beforeId: entityId.optional(),
  afterId: entityId.optional(),
}).refine((input) => !input.beforeId || !input.afterId, { path: ["beforeId"] });
export const editTaskInput = z.strictObject({
  revision,
  ...taskFields,
  recurrence: recurrenceChange.nullable().optional(),
  destination: z.strictObject({ projectId: entityId, sectionId: entityId.nullable() }).optional(),
});
export const completeTaskInput = z.strictObject({
  revision,
  occurrenceId: entityId.optional(),
  includeChildren: z.boolean().optional(),
});
export const undoTaskCompletionInput = z.strictObject({
  revision,
  occurrenceId: entityId.optional(),
  completedChildIds: z.array(entityId).optional().default([]),
}).refine((input) => !input.occurrenceId || input.completedChildIds.length === 0, {
  path: ["completedChildIds"],
  message: "Uma conclusão recorrente não pode incluir subtarefas.",
}).refine((input) => new Set(input.completedChildIds).size === input.completedChildIds.length, {
  path: ["completedChildIds"],
  message: "Não repita subtarefas.",
});
const positionTarget = z.strictObject({
  type: z.literal("position"),
  projectId: entityId,
  sectionId: entityId.nullable(),
  parentId: entityId.nullable(),
  beforeId: entityId.optional(),
  afterId: entityId.optional(),
}).refine((target) => !(target.beforeId && target.afterId), { path: ["beforeId"] });
export const taskMoveInput = z.strictObject({
  revision,
  target: z.discriminatedUnion("type", [positionTarget, z.strictObject({ type: z.literal("promote") })]),
});
export const labelTasksQuery = z.strictObject({
  cursor: z.string().min(1).max(128).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(200)).optional()
    .transform((value) => value ?? 50),
});

export const todayQuery = z.strictObject({ includeCompleted: queryBool.optional() });
export const upcomingQuery = z.strictObject({ start: civilDate.optional() });
export const searchDate = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["today", "overdue", "none"]) }),
  z.strictObject({ kind: z.literal("range"), from: civilDate, to: civilDate })
    .refine(({ from, to }) => from <= to, { path: ["to"] }),
]);
export const searchInput = z.strictObject({
  text: z.string().refine((value) => value.isWellFormed()).optional(),
  projectId: entityId.optional(),
  labelId: entityId.optional(),
  priority: priority.optional(),
  date: searchDate.optional(),
  includeCompleted: z.boolean().default(false),
  cursor: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type ProjectPayload = z.infer<typeof projectPayload>;
export type SectionPayload = z.infer<typeof sectionPayload>;
export type TaskPayload = z.infer<typeof taskPayload>;
export type LabelPayload = z.infer<typeof labelPayload>;
export type CreateTaskInput = z.infer<typeof createTaskInput>;
export type EditTaskInput = z.infer<typeof editTaskInput>;
export type TaskMoveInput = z.infer<typeof taskMoveInput>;
export type CompleteTaskInput = z.infer<typeof completeTaskInput>;
export type UndoTaskCompletionInput = z.infer<typeof undoTaskCompletionInput>;
export type ProjectView = z.infer<typeof projectView>;
export type RecurrenceRule = z.infer<typeof recurrenceRule>;
export type SetRecurrenceInput = z.infer<typeof setRecurrenceInput>;
export type CompletedOccurrencePayload = z.infer<typeof completedOccurrencePayload>;
export type SearchInput = z.infer<typeof searchInput>;

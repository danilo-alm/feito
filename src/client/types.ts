// Tipos de resposta da API /api/v1 (docs/02-backend-endpoints.md, seção 2).
import type { ProjectColor, ProjectIcon } from "@/validation/project-style";

export type Priority = 1 | 2 | 3 | 4;
export type Frequency = "daily" | "weekly" | "monthly";
export type Theme = "light" | "dark" | "system";
export type Layout = "list" | "board";
export type SortMode = "manual" | "date" | "priority";

export type Origin = {
  projectName: string;
  isInbox: boolean;
  sectionName: string | null;
  parentTitle: string | null;
};

export type TaskItem = {
  id: string;
  revision: number;
  title: string;
  descriptionExcerpt: string | null;
  priority: Priority;
  status: "active" | "completed";
  completedAt: string | null;
  dueDate: string | null;
  dueTime: string | null;
  overdue: boolean;
  recurrence: { frequency: Frequency } | null;
  occurrenceId: string | null;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  childIds: string[];
  subtasks: { total: number; completed: number };
  labels: { id: string; name: string }[];
  origin?: Origin;
};

export type RecurrenceRule = {
  frequency: Frequency;
  anchorDate: string;
  time: string | null;
  nominalDate: string;
};

export type TaskDetail = TaskItem & {
  description: string;
  createdAt: string;
  recurrenceRule: RecurrenceRule | null;
  children: TaskItem[];
};

export type NamedDetails = { name: string; description: string };
export type Section = NamedDetails & { id: string; revision: number; taskCount: number };
export type ProjectView = { layout: Layout; sortMode: SortMode; showCompleted: boolean };

export type ProjectStyle = { color: ProjectColor | null; icon: ProjectIcon };
export type ProjectDetails = NamedDetails & ProjectStyle;

export type ProjectSummary = ProjectDetails & {
  id: string;
  revision: number;
  defaultSectionName: string | null;
  isInbox: boolean;
  status: "active" | "archived";
  activeCount: number;
};

export type ProjectPage = {
  referenceDate: string;
  project: ProjectSummary & { view: ProjectView };
  sections: Section[];
  groups: { sectionId: string | null; rootIds: string[] }[];
  tasks: TaskItem[];
};

export type Label = { id: string; revision: number; name: string; activeCount: number };
export type Preferences = { timezone: string; theme: Theme };
export type User = { id: string; email: string };

export type Session = { user: User; mustChangePassword: boolean };
export type Me = Session & { preferences: Preferences; inboxProjectId: string; referenceDate: string };

export type Navigation = {
  inbox: { projectId: string; activeCount: number };
  todayCount: number;
  projects: ProjectSummary[];
  archivedCount: number;
  labels: Label[];
  referenceDate: string;
};

export type TodayView = {
  referenceDate: string;
  timezone: string;
  overdue: TaskItem[];
  today: TaskItem[];
  completedToday?: TaskItem[];
};

export type UpcomingView = {
  referenceDate: string;
  start: string;
  days: { date: string; tasks: TaskItem[] }[];
};

export type SearchDate =
  | { kind: "today" | "overdue" | "none" }
  | { kind: "range"; from: string; to: string };

export type SearchInput = {
  text?: string;
  projectId?: string;
  labelId?: string;
  priority?: Priority;
  date?: SearchDate;
  includeCompleted?: boolean;
  cursor?: string;
  limit?: number;
};

export type Page<T> = { referenceDate: string; nextCursor: string | null } & T;
export type SearchResult = Page<{ results: TaskItem[] }>;
export type LabelTasks = Page<{ tasks: TaskItem[] }>;

export type PositionTarget = {
  type: "position";
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  beforeId?: string;
  afterId?: string;
};
export type MoveTarget = PositionTarget | { type: "promote" };

export type MoveResponse = {
  task: TaskItem;
  groups: { projectId: string; sectionId: string | null; parentId: string | null; orderedIds: string[] }[];
};

export type CompleteResponse = { task: TaskItem; completedChildIds: string[]; alreadyProcessed: boolean };
export type ReopenResponse = { task: TaskItem; reopenedParentId: string | null };
export type UndoCompletionInput = { revision: number; occurrenceId?: string; completedChildIds: string[] };
export type UndoCompletionResponse = { task: TaskItem; reopenedChildIds: string[]; reopenedParentId: string | null };

export type CreateTask = {
  title: string;
  description?: string;
  projectId?: string;
  sectionId?: string | null;
  parentId?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  labelIds?: string[];
  recurrence?: { frequency: Frequency; anchorDate?: string; time?: string | null } | null;
};

export type EditTask = {
  revision: number;
  title?: string;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  labelIds?: string[];
  recurrence?: { frequency: Frequency; anchorDate: string; time?: string | null } | null;
  destination?: { projectId: string; sectionId: string | null };
};

export type ImportCounts = {
  projects: number;
  archivedProjects: number;
  sections: number;
  tasks: number;
  completedTasks: number;
  labels: number;
  occurrences: number;
};

export type ImportPreview = {
  schemaVersion: number | null;
  counts: ImportCounts | null;
  errors: { path: string; message: string }[];
  destinationEmpty: boolean;
  previewToken: string | null;
  expiresAt: string | null;
};

export type ImportResult = { operationId: string; summary: ImportCounts };

export type SourceImportProject = {
  name: string; layout: Layout; sections: number; tasks: number; subtasks: number; dated: number; recurring: number;
};

export type SourceImportPreview = {
  source: string;
  /** Projeto existente que recebe as tarefas; `null` cria projetos novos. */
  target: { id: string; name: string } | null;
  counts: ImportCounts | null;
  projects: SourceImportProject[];
  warnings: string[];
  errors: { path: string; message: string }[];
  referenceDate: string;
  previewToken: string | null;
  expiresAt: string | null;
};

/** `projectIds` só vem na primeira confirmação; repetições devolvem apenas o resumo. */
export type SourceImportResult = ImportResult & { projectIds?: string[] };

// ---------- Compartilhamento público ----------

export type ProjectShare = { enabled: false; token: null } | { enabled: true; token: string };

export type PublicTask = Pick<TaskItem,
  "id" | "sectionId" | "parentId" | "title" | "descriptionExcerpt" | "status" | "completedAt" | "priority"
  | "dueDate" | "dueTime" | "overdue" | "recurrence" | "childIds" | "subtasks" | "labels"> & { description: string };

export type PublicProjectPage = {
  referenceDate: string;
  project: { id: string; name: string; defaultSectionName: string | null; status: "active"; view: ProjectView; activeCount: number };
  sections: { id: string; name: string; taskCount: number }[];
  groups: { sectionId: string | null; rootIds: string[] }[];
  tasks: PublicTask[];
};

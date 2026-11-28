// Tipos de resposta da API /api/v1 (docs/02-backend-endpoints.md, seção 2).
import type { ProjectColor, ProjectIcon } from "./validation/project-style";

export type Priority = 1 | 2 | 3 | 4;
export type Frequency = "daily" | "weekly" | "monthly";
export type Theme = "light" | "dark" | "system";
// Temas com nome: o modo (Theme) escolhe entre o tema claro e o escuro das preferências.
export const LIGHT_THEMES = ["feito-light", "catppuccin-latte", "solarized-light"] as const;
export const DARK_THEMES = [
  "feito-dark", "feito-black", "catppuccin-mocha", "catppuccin-macchiato", "monokai-pro-spectrum", "dracula",
  "nord", "tokyo-night", "gruvbox-dark", "one-dark", "rose-pine", "solarized-dark",
] as const;
export type LightTheme = typeof LIGHT_THEMES[number];
export type DarkTheme = typeof DARK_THEMES[number];
export type Accent = "green" | "violet";
export type Layout = "list" | "board" | "calendar" | "table";
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
  recurrenceRule?: RecurrenceRule | null;
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
  /** Comments on this task. Load them with `GET /tasks/{id}/comments`. */
  commentCount: number;
};

/**
 * Comment on a task. Accounts have a single user, so the author is always the account owner
 * (`Me.user`); local workspaces have no account.
 */
export type TaskComment = {
  id: string;
  taskId: string;
  revision: number;
  body: string;
  createdAt: string;
  /** Instant of the latest edit, or null when never edited. */
  editedAt: string | null;
};

/** Comments of one task, oldest first. */
export type TaskComments = { comments: TaskComment[] };

export type NamedDetails = { name: string; description: string };
export type Section = NamedDetails & { id: string; revision: number; taskCount: number };
export type ProjectView = { layout: Layout; sortMode: SortMode; showCompleted: boolean };

export type ProjectStyle = { color: ProjectColor | null; icon: ProjectIcon };
export type ProjectDetails = NamedDetails & ProjectStyle;

export type ProjectSummary = ProjectDetails & {
  id: string;
  revision: number;
  defaultSectionName: string | null;
  /** Parent project shown in the sidebar, or null at the top level. */
  parentId: string | null;
  isInbox: boolean;
  status: "active" | "archived";
  activeCount: number;
};

export type ProjectPage = {
  referenceDate: string;
  project: Omit<ProjectSummary, "parentId"> & { view: ProjectView };
  sections: Section[];
  groups: { sectionId: string | null; rootIds: string[] }[];
  tasks: TaskItem[];
};

export type Label = { id: string; revision: number; name: string; activeCount: number };
export type Locale = "pt-BR" | "pt-PT" | "en" | "es" | "fr" | "it" | "de";
// Ausente nos documentos anteriores à internacionalização: usar o idioma padrão.
export type Preferences = {
  timezone: string; theme: Theme; locale?: Locale; todayLayout?: Layout; upcomingLayout?: Layout;
  // Ausentes: Feito Claro, Feito Escuro e destaque verde.
  lightTheme?: LightTheme; darkTheme?: DarkTheme; accent?: Accent;
  // Hoje abre na Agenda, a menos que seja false (escolheu-se outro layout, guardado em todayLayout).
  todayTimeline?: boolean;
};
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
/** Manual order of projects and labels: before or after a sibling, or at the end without an anchor. */
export type OrderAnchor = { beforeId?: string; afterId?: string };
/** Project move: `parentId: null` moves to the top level, absent keeps the current parent. */
export type ProjectMove = OrderAnchor & { parentId?: string | null };

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
  beforeId?: string;
  afterId?: string;
};

export type TaskState = TaskItem & {
  description?: string;
  createdAt?: string;
};

export type TaskChanges = {
  revision: number;
  rows: { before?: TaskState; after?: TaskState }[];
  groups?: MoveResponse["groups"];
};

export type TaskMutation<T> = { result: T; changes: TaskChanges };

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

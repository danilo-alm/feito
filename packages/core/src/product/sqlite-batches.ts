import type { ImportResult, User } from "../types";
import type { Workspace } from "./local-workspace";
import type { Operation, Replica } from "./replica";

/** Identity and revision captured with the working rows used to evaluate a command. */
export type SQLiteSelection = {
  spaceId: string;
  epoch: string;
  generation: number;
};

export type SQLiteTitleEdit = {
  selection: SQLiteSelection;
  taskId: string;
  revision: number;
  title: string;
  operation?: Operation;
};

export type SQLiteCommit = { generation: number; revision: number } | "conflict" | "duplicate";


/** Source data for a one-time import into a new, empty SQLite file. */
export type SQLiteProfile = {
  selection: {
    generation: number;
    epoch: string;
    spaceId?: string;
    currentServerId?: string;
    discoverSession: boolean;
    revokeSession?: string;
  };
  local?: {
    id: string;
    workspace: Workspace;
    imports?: Record<string, { binding: string; result: ImportResult }>;
  };
  accountWithoutReplica?: { id: string; origin: string; user: User };
  remotes: (Replica & { id: string; origin: string; order?: number })[];
};

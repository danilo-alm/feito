import type { Workspace } from "@feito/core/product/local-executor";
import type { Replica } from "@feito/core/product/replica";
import type { ImportResult, User } from "@feito/core/types";

export type Space = { kind: "none" } | { kind: "local" } | { kind: "account"; user: User };
export type LocalSpace = { workspace: Workspace; imports?: Record<string, { binding: string; result: ImportResult }> };
export type SpaceData = LocalSpace | Replica;
export type Selection = {
  epoch: string;
  space: Space;
  discoverSession: boolean;
  revokeSession?: string;
};
export type BrowserRecord = {
  generation: number;
  selection: Selection;
  data?: SpaceData;
};
export type BrowserUpdate = {
  selection?: Selection;
  data?: SpaceData;
  localIfMissing?: LocalSpace;
  deleteAccount?: string;
};
export type BrowserSummary = Pick<BrowserRecord, "generation" | "selection"> & { loaded: boolean; pending: number; notice?: string };
export type BrowserProductRequest = {
  epoch: string;
  method: string;
  path: string;
  read: boolean;
  id?: string;
  authoredAt: string;
  body?: unknown;
  taskChanges: boolean;
};
export type BrowserProductResult = {
  status: number;
  body: unknown;
  summary: BrowserSummary;
  committed?: boolean;
};

export type BrowserStorage = {
  read(): Promise<BrowserRecord>;
  summary?(): Promise<BrowserSummary>;
  product?(request: BrowserProductRequest): Promise<BrowserProductResult>;
  commit(generation: number, update: BrowserUpdate): Promise<boolean>;
};

export function accountReplica(record: BrowserRecord) {
  return record.selection.space.kind === "account" ? record.data as Replica | undefined : undefined;
}

export function localSpace(record: BrowserRecord) {
  return record.selection.space.kind === "local" ? record.data as LocalSpace | undefined : undefined;
}

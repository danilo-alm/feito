import type { BrowserProductRequest, BrowserProductResult, BrowserRecord, BrowserSummary, BrowserUpdate } from "../storage";

export type StorageRequest =
  | { id: number; action: "read" | "summary" }
  | { id: number; action: "commit"; generation: number; update: BrowserUpdate }
  | { id: number; action: "product"; request: BrowserProductRequest };

export type StorageValue = BrowserRecord | boolean | BrowserSummary | BrowserProductResult;
export type StorageResponse = { id: number; value: StorageValue } | { id: number; error: string };

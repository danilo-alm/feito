"use client";
import { useSyncExternalStore } from "react";
import { clearDownloadUrls, configureApi } from "@feito/ui/client/api";
import { registerTagOrder } from "@feito/ui/client/colors";
import { clearComposer } from "@feito/ui/client/composer";
import { closeEditor } from "@feito/ui/client/editor-store";
import { clearCache, invalidate } from "@feito/ui/client/store";
import { clearTaskMutationQueues } from "@feito/ui/client/task-mutations";
import { applyTheme } from "@feito/ui/components/app";
import { clearInlineCreateQueues } from "@feito/ui/components/task-editor";
import { createBrowserSqliteStorage } from "./sqlite/client";
import { createBrowserWorkspace, initialStatus } from "./workspace";

const channelName = "feito:browser:changed";
let channel: BroadcastChannel | undefined;

function signalChange() {
  channel?.postMessage(null);
  if (!channel) {
    try { localStorage.setItem(channelName, crypto.randomUUID()); } catch { /* Foco e visibilidade também revalidam. */ }
  }
}

function clearMemory() {
  clearCache();
  clearDownloadUrls();
  clearComposer();
  closeEditor();
  clearTaskMutationQueues();
  clearInlineCreateQueues();
  registerTagOrder([], []);
  applyTheme("system", false);
}

export const workspace = createBrowserWorkspace({
  storage: createBrowserSqliteStorage(process.env.FEITO_SQLITE_WORKER!),
  exclusive: async (name, run) => await (navigator.locks ? navigator.locks.request("feito:browser:" + name, run) : run()),
  changed: signalChange,
  onData: () => { void invalidate(undefined, { retainInactive: true }); },
  onSwitch: clearMemory,
});

export function useBrowserStatus() {
  return useSyncExternalStore(workspace.subscribe, workspace.getStatus, () => initialStatus);
}

export function persistBrowserData() {
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch { /* A permissão opcional não impede abrir o espaço. */ }
}

export function startBrowserWorkspace() {
  configureApi({ fetch: workspace.fetch, onAuthFailure: undefined });
  try { localStorage.removeItem("feito:theme"); } catch { /* Preferências são lidas no espaço selecionado. */ }

  let stream: EventSource | undefined;
  let epoch: string | undefined;
  let disconnected = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 1_000;

  function observe() {
    const status = workspace.getStatus();
    const next = status.space.kind === "account" && status.loaded && status.sync !== "login" && navigator.onLine
      ? status.epoch : undefined;
    if (next === epoch && !disconnected) return;
    if (next === epoch && retry !== undefined) return;
    stream?.close();
    epoch = next;
    disconnected = false;
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
    if (!epoch) return;

    const events = new EventSource("/api/v1/product-events");
    stream = events;
    events.addEventListener("revision", (event: MessageEvent<string>) => {
      if (events !== stream || events.readyState === EventSource.CLOSED) return;
      delay = 1_000;
      const revision = Number(event.data);
      if (Number.isSafeInteger(revision) && revision >= 0) void workspace.sync({ revision });
    });
    events.onerror = () => {
      if (events !== stream || events.readyState !== EventSource.CLOSED) return;
      disconnected = true;
      retry = setTimeout(() => {
        retry = undefined;
        void workspace.sync();
        observe();
      }, delay);
      delay = Math.min(delay * 2, 60_000);
    };
  }

  function reconnect() {
    observe();
    void workspace.reconnect();
  }
  function refresh() {
    void workspace.refresh().then(() => {
      const { sync, pending } = workspace.getStatus();
      if (pending && sync !== "login" && sync !== "error") void workspace.sync();
    });
  }
  function visible() {
    if (document.visibilityState === "visible") reconnect();
  }
  function storageEvent(event: StorageEvent) {
    if (event.key === channelName) refresh();
  }

  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = refresh;
    }
  } catch { /* Use o evento de armazenamento se o canal estiver indisponível. */ }
  const unsubscribe = workspace.subscribe(observe);
  window.addEventListener("storage", storageEvent);
  window.addEventListener("online", reconnect);
  window.addEventListener("offline", reconnect);
  window.addEventListener("focus", reconnect);
  window.addEventListener("pageshow", reconnect);
  document.addEventListener("visibilitychange", visible);
  const timer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const { space, sync } = workspace.getStatus();
    if (space.kind !== "account") {
      void workspace.reconnect();
      return;
    }
    if (sync !== "login" && sync !== "error" && (!stream || stream.readyState !== EventSource.OPEN)) {
      void workspace.sync();
    }
  }, 30_000);
  reconnect();

  return () => {
    unsubscribe();
    stream?.close();
    if (retry !== undefined) clearTimeout(retry);
    clearInterval(timer);
    channel?.close();
    channel = undefined;
    window.removeEventListener("storage", storageEvent);
    window.removeEventListener("online", reconnect);
    window.removeEventListener("offline", reconnect);
    window.removeEventListener("focus", reconnect);
    window.removeEventListener("pageshow", reconnect);
    document.removeEventListener("visibilitychange", visible);
  };
}

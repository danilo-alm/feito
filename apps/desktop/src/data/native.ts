import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { clearCache, invalidate } from "@feito/ui/client/store";
import { createDesktop, type Bridge } from "./desktop";

const nativeBridge: Bridge = {
  read: () => invoke("read_workspace"),
  write: (generation, value) => invoke("write_workspace", { generation, value }),
  request: (origin, method, path, body) => invoke("server_request", { origin, method, path, body }),
};

/** Só em desenvolvimento e fora do Tauri: guarda o espaço local na memória para conferir a interface no navegador. */
function previewBridge(): Bridge {
  let stored: Awaited<ReturnType<Bridge["read"]>> = null;
  return {
    read: async () => structuredClone(stored),
    write: async (generation, value) => {
      stored = { generation: (generation ?? 0) + 1, value: structuredClone(value) };
      return structuredClone(stored);
    },
    request: async () => { throw new Error("A prévia no navegador não conecta a servidores."); },
  };
}

const bridge = import.meta.env.DEV && !isTauri() ? previewBridge() : nativeBridge;

export const desktop = createDesktop(bridge, () => { void invalidate(); }, clearCache);

export const openPublicProject = (origin: string, token: string) =>
  invoke<void>("open_public_project", { origin, token });

let eventCommands = Promise.resolve();

export function watchServer(origin: string) {
  let active = true;
  let connected = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 1_000;
  let subscription: number | undefined;

  function reconnect() {
    if (!active) return;
    connected = false;
    retry = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 60_000);
  }

  function connect() {
    const channel = new Channel<number | null>();
    channel.onmessage = (revision) => {
      if (!active) return;
      if (revision === null) return reconnect();
      connected = true;
      delay = 1_000;
      void desktop.syncForRevision(origin, revision);
    };
    eventCommands = eventCommands.then(async () => {
      if (!active) return;
      try {
        subscription = await invoke<number>("start_product_events", { origin, channel });
      } catch {
        reconnect();
      }
    });
  }

  connect();
  return {
    connected: () => connected,
    close() {
      active = false;
      clearTimeout(retry);
      eventCommands = eventCommands.then(async () => {
        if (subscription !== undefined) {
          await invoke("stop_product_events", { subscription }).catch(() => undefined);
        }
      });
    },
  };
}

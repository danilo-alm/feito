"use client";
import { useT } from "@feito/ui/components/language";

import { useEffect, useSyncExternalStore } from "react";
import { IconDownload } from "@feito/ui/components/icons";
import { SettingsGroup, SettingsRow } from "@feito/ui/components/settings";

const hints = {
  preparing: "Preparando os arquivos para abrir o Feito sem conexão…",
  ready: "Pronto para uso offline neste navegador.",
  waiting: "Atualização disponível. Salve suas edições e feche todas as abas do Feito para usar a nova versão ao reabrir.",
  failed: "Não foi possível preparar o acesso offline. Verifique a conexão e o espaço disponível no navegador.",
  unsupported: "O acesso offline está indisponível neste navegador.",
  development: "A preparação offline está disponível no build de produção.",
};
type Status = keyof typeof hints;
let status: Status = "preparing";
let registration: ServiceWorkerRegistration | undefined;
let pending: Promise<void> | undefined;
let latestCheck = 0;
const listeners = new Set<() => void>();
const observedWorkers = new WeakSet<ServiceWorker>();

function publish(next: Status) {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function cacheReady(worker: ServiceWorker) {
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => finish(false), 20_000);
    function finish(ready: boolean) {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(ready);
    }
    channel.port1.onmessage = (event) => finish(event.data === true);
    try {
      worker.postMessage("feito:prepare-offline", [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

async function refreshStatus() {
  const current = registration;
  if (!current) return;
  const request = ++latestCheck;
  const worker = current.installing ?? current.waiting ?? current.active;
  if (worker && !observedWorkers.has(worker)) {
    observedWorkers.add(worker);
    worker.addEventListener("statechange", () => void refreshStatus());
  }
  if (current.waiting && current.active) return publish("waiting");
  const controller = navigator.serviceWorker.controller ?? current.active;
  if (controller?.state !== "activated") return publish(worker && worker.state !== "redundant" ? "preparing" : "failed");
  const ready = await cacheReady(controller);
  if (request === latestCheck) publish(ready ? "ready" : "failed");
}

function prepare(checkUpdate = false): Promise<void> {
  if (pending) return pending;
  if (process.env.NODE_ENV !== "production") {
    publish("development");
    return Promise.resolve();
  }
  if (!("serviceWorker" in navigator)) {
    publish("unsupported");
    return Promise.resolve();
  }

  if (status === "failed") publish("preparing");
  pending = (async () => {
    try {
      const workers = navigator.serviceWorker;
      const script = "/service-worker.js";
      const existing = await workers.getRegistration();
      const installed = existing && (existing.active ?? existing.installing ?? existing.waiting)?.scriptURL;
      const next = installed === new URL(script, location.origin).href && existing
        ? existing
        : await workers.register(script, { scope: "/", updateViaCache: "none" });
      if (next !== registration) {
        registration = next;
        next.addEventListener("updatefound", () => void refreshStatus());
      }
      if (checkUpdate && next.active && !next.installing && !next.waiting) await next.update().catch(() => undefined);
      await refreshStatus();
    } catch {
      publish("failed");
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

export function OfflineRegistration() {
  useEffect(() => {
    const reconnect = () => { void prepare(); };
    const controllerChanged = () => { void refreshStatus(); };
    window.addEventListener("online", reconnect);
    navigator.serviceWorker?.addEventListener("controllerchange", controllerChanged);
    reconnect();
    return () => {
      window.removeEventListener("online", reconnect);
      navigator.serviceWorker?.removeEventListener("controllerchange", controllerChanged);
    };
  }, []);
  return null;
}

export function OfflineStatus() {
  const t = useT();
  const state = useSyncExternalStore(subscribe, () => status, () => "preparing" as Status);
  const check = state === "ready" || state === "failed";
  return <SettingsGroup id="acesso-offline" title={t("Acesso offline")}>
    <div className="set-card">
      <SettingsRow icon={<IconDownload />} label={t("Arquivos do aplicativo")} hint={<span role="status">{t(hints[state])}</span>}
        control={check && <button type="button" className="btn" onClick={() => void prepare(true)}>
          {state === "ready" ? t("Verificar atualização") : t("Tentar novamente")}
        </button>} />
    </div>
  </SettingsGroup>;
}

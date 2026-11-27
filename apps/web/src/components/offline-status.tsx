"use client";
import { useT } from "@feito/ui/components/language";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { IconDownload } from "@feito/ui/components/icons";
import { SettingsGroup, SettingsRow } from "@feito/ui/components/settings";
import { Dialog } from "@feito/ui/components/ui";

const hints = {
  preparing: "Preparando os arquivos para abrir o Feito sem conexão…",
  ready: "Pronto para uso offline neste navegador.",
  failed: "Não foi possível preparar o acesso offline. Verifique a conexão e o espaço disponível no navegador.",
  unsupported: "O acesso offline está indisponível neste navegador.",
  development: "A preparação offline está disponível no build de produção.",
};
type Status = keyof typeof hints;
const failures = {
  tabs: "Ainda há outras abas ou janelas do Feito abertas. Feche-as e tente de novo.",
  failed: "Não foi possível atualizar. Tente de novo.",
};
const CHECK_INTERVAL = 60 * 60 * 1000;
let status: Status = "preparing";
let updateAvailable = false;
let lastUpdateCheck = 0;
let registration: ServiceWorkerRegistration | undefined;
let pending: Promise<void> | undefined;
let latestCheck = 0;
const listeners = new Set<() => void>();
const observedWorkers = new WeakSet<ServiceWorker>();

function notify() {
  for (const listener of listeners) listener();
}

function publish(next: Status) {
  if (status === next) return;
  status = next;
  notify();
}

function publishUpdate(next: boolean) {
  if (updateAvailable === next) return;
  updateAvailable = next;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function ask(worker: ServiceWorker, message: unknown) {
  return new Promise<unknown>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => finish(undefined), 20_000);
    function finish(answer: unknown) {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(answer);
    }
    channel.port1.onmessage = (event) => finish(event.data);
    try {
      worker.postMessage(message, [channel.port2]);
    } catch {
      finish(undefined);
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
  const active = current.active;
  if (active?.state !== "activated") return publish(worker && worker.state !== "redundant" ? "preparing" : "failed");
  // A versão vem antes: ela pode trocar o conjunto de arquivos que será conferido.
  const version = await ask(active, { type: "feito:version", build: process.env.FEITO_BUILD }) as { update?: boolean } | undefined;
  const ready = await ask(active, "feito:prepare-offline");
  if (request !== latestCheck) return;
  publishUpdate(version?.update === true);
  publish(ready === true ? "ready" : "failed");
  // Depois das consultas o worker ativo está livre para dar lugar ao novo.
  current.waiting?.postMessage("feito:activate");
}

async function applyUpdate(): Promise<keyof typeof failures | undefined> {
  const active = registration?.active;
  const answer = active && await ask(active, "feito:update");
  if (answer !== "ready") return answer === "tabs" ? "tabs" : "failed";
  location.reload();
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
      if (checkUpdate && next.active && !next.installing && !next.waiting) {
        lastUpdateCheck = Date.now();
        await next.update().catch(() => undefined);
      }
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
    const reconnect = () => { void prepare(true); };
    // Uma aba que fica aberta não navega: procure a versão nova de tempos em tempos.
    const revisit = () => {
      if (document.visibilityState === "visible" && Date.now() - lastUpdateCheck >= CHECK_INTERVAL) reconnect();
    };
    const controllerChanged = () => { void refreshStatus(); };
    const timer = window.setInterval(revisit, CHECK_INTERVAL);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", revisit);
    navigator.serviceWorker?.addEventListener("controllerchange", controllerChanged);
    reconnect();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", revisit);
      navigator.serviceWorker?.removeEventListener("controllerchange", controllerChanged);
    };
  }, []);
  return null;
}

function useUpdateAvailable() {
  return useSyncExternalStore(subscribe, () => updateAvailable, () => false);
}

function useUpdateDialog(): [ReactNode, () => void] {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<keyof typeof failures>();
  async function update() {
    setBusy(true);
    setFailure(undefined);
    const result = await applyUpdate();
    // Sem falha, a página já está recarregando.
    if (!result) return;
    setFailure(result);
    setBusy(false);
  }
  const dialog = <Dialog open={open} onClose={() => setOpen(false)} title={t("Atualizar o Feito")} width={440}
    footer={<>
      <button type="button" className="btn ghost" onClick={() => setOpen(false)}>{t("Agora não")}</button>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void update()}>{t("Atualizar")}</button>
    </>}>
    <div className="dialog-b">
      <p>{t("Feche outras abas do Feito antes de prosseguir.")}</p>
      <p className="hint">{t("Salve o que estiver editando: a página será recarregada.")}</p>
      {failure && <p role="alert">{t(failures[failure])}</p>}
    </div>
  </Dialog>;
  return [dialog, () => { setFailure(undefined); setOpen(true); }];
}

export function UpdateNotice() {
  const t = useT();
  const available = useUpdateAvailable();
  const [dialog, openDialog] = useUpdateDialog();
  return <>
    {available && <div className="update-notice" role="status">
      <span>{t("Nova versão disponível")}</span>
      <button type="button" className="btn primary" onClick={openDialog}>{t("Atualizar")}</button>
    </div>}
    {dialog}
  </>;
}

export function OfflineStatus() {
  const t = useT();
  const state = useSyncExternalStore(subscribe, () => status, () => "preparing" as Status);
  const available = useUpdateAvailable();
  const [dialog, openDialog] = useUpdateDialog();
  const check = state === "ready" || state === "failed";
  return <SettingsGroup id="acesso-offline" title={t("Acesso offline")}>
    <div className="set-card">
      <SettingsRow icon={<IconDownload />} label={t("Arquivos do aplicativo")}
        hint={<span role="status">{t(available ? "Atualização disponível." : hints[state])}</span>}
        control={available ? <button type="button" className="btn" onClick={openDialog}>{t("Atualizar")}</button>
          : check && <button type="button" className="btn" onClick={() => void prepare(true)}>
            {state === "ready" ? t("Verificar atualização") : t("Tentar novamente")}
          </button>} />
    </div>
    {dialog}
  </SettingsGroup>;
}

"use client";
import { useT } from "@feito/ui/components/language";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { NavigationProvider } from "@feito/ui/navigation";
import { AppProviders, AppShell } from "@feito/ui/components/app";
import { MobileChrome, Sidebar } from "@feito/ui/components/chrome";
import { lazyScreen } from "@feito/ui/components/lazy-screen";
import { QuickAdd } from "@feito/ui/components/quick-add";
import { TaskDetailDialog } from "@feito/ui/components/task-detail";
import { Spinner } from "@feito/ui/components/ui";
import { Browse, Inbox, Label, ProjectView, Search, Today, Upcoming } from "@feito/ui/screens/deferred";
import { startBrowserWorkspace, useBrowserStatus, workspace } from "@/browser/client";
import { BrowserLink, browserRouter, safeNext, useBrowserRoute } from "@/browser/navigation";
import { ChangePasswordForm, LoginForm } from "./auth-forms";
import { UpdateNotice } from "./offline-status";
import { syncLabels, pendingLabel } from "./sync-labels";
import { SyncStatus } from "@feito/ui/components/sync-status";

const BrowserSettings = lazyScreen(async () => ({ default: (await import("./settings")).BrowserSettings }));

const routes: Record<string, ReactNode> = {
  "/hoje": <Today />,
  "/entrada": <Inbox />,
  "/em-breve": <Upcoming />,
  "/busca": <Search />,
  "/navegar": <Browse />,
  "/ajustes": <BrowserSettings />,
};
const titles: Partial<Record<string, string>> = {
  "/hoje": "Hoje", "/entrada": "Entrada", "/em-breve": "Em breve", "/busca": "Busca",
  "/navegar": "Navegar", "/ajustes": "Ajustes", "/entrar": "Entrar", "/trocar-senha": "Senha",
};

function LoadingWorkspace({ children, busy = false }: { children?: ReactNode; busy?: boolean }) {
  const t = useT();
  return <main id="conteudo" className="empty" style={{ paddingTop: "min(20vh, 120px)" }}>
    {busy ? <Spinner label={t("Carregando o Feito")} /> : children}
  </main>;
}

function LabelPage({ id }: { id: string }) {
  const t = useT();
  const [params] = useState(() => Promise.resolve({ id }));
  return <Suspense fallback={<Spinner label={t("Carregando etiqueta")} />}>
    <Label params={params} />
  </Suspense>;
}

function BrowserContent() {
  const t = useT();
  const route = useBrowserRoute();
  const status = useBrowserStatus();
  const { pathname } = route;
  useEffect(startBrowserWorkspace, []);
  const login = pathname === "/entrar";
  const password = pathname === "/trocar-senha";
  const home = pathname === "/" || pathname === "/navegador";
  const replayLogin = route.searchParams.get("reautenticar") === "1";

  let destination: string | undefined;
  if (status.ready && !status.discovering && !status.storageError) {
    if (status.provisional && !password) destination = "/trocar-senha";
    else if (status.space.kind === "none" && !login) {
      destination = password || home ? "/entrar" : `/entrar?voltar=${encodeURIComponent(pathname + route.search + route.hash)}`;
    } else if (status.space.kind === "account" && login && !replayLogin && status.sync !== "login") {
      destination = safeNext(route);
    } else if (status.space.kind !== "none" && home) destination = "/hoje";
    else if (status.space.kind === "local" && password) destination = "/ajustes";
  }

  useEffect(() => {
    if (destination) browserRouter.replace(destination);
  }, [destination]);

  useEffect(() => {
    const title = titles[pathname];
    document.title = title ? `${t(title)} · Feito` : "Feito";
  }, [pathname, t]);

  let page: ReactNode;
  if (status.storageError && !status.ready) {
    page = <LoadingWorkspace>
      <p role="alert">{status.error && t(status.error)}</p>
      <button type="button" className="btn" onClick={() => void workspace.reconnect()}>{t("Tentar de novo")}</button>
    </LoadingWorkspace>;
  } else if (!status.ready || status.discovering || destination) {
    page = <LoadingWorkspace busy />;
  } else if (login) {
    page = <LoginForm />;
  } else if (password) {
    page = <ChangePasswordForm />;
  } else if (!status.loaded) {
    page = status.sync === "syncing" || status.space.kind === "local" ? <LoadingWorkspace busy /> : <LoadingWorkspace>
      <p role="alert">{status.error ? t(status.error) : t("Não foi possível abrir a cópia neste navegador.")}</p>
      {status.sync === "login"
        ? <BrowserLink className="btn" href="/entrar?reautenticar=1">{t("Entrar novamente")}</BrowserLink>
        : <button type="button" className="btn" onClick={() => void workspace.sync({ force: true })}>{t("Tentar de novo")}</button>}
      <BrowserLink className="btn ghost" href="/entrar?reautenticar=1">{t("Escolher outro espaço")}</BrowserLink>
    </LoadingWorkspace>;
  } else {
    const id = /^\/(projetos|etiquetas)\/([0-9a-f-]+)$/i.exec(pathname);
    const linked = route.searchParams.get("tarefa");
    let screen = routes[pathname] ?? routes["/hoje"];
    const sharing = status.space.kind === "local" ? { unavailable: t("Entre em uma conta para compartilhar este projeto.") }
      : status.sync === "offline" ? { unavailable: t("Reconecte-se para compartilhar este projeto.") }
      : status.sync === "login" ? { unavailable: t("Entre novamente para compartilhar este projeto.") }
      : undefined;
    if (id?.[1] === "projetos") screen = <ProjectView key={id[2]} projectId={id[2]} sharing={sharing} />;
    if (id?.[1] === "etiquetas") screen = <LabelPage key={id[2]} id={id[2]} />;
    page = <AppShell manageAuthentication={false} persistTheme={false}
      renderChrome={(nav) => <Sidebar nav={nav} />}
      renderOverlays={(state, close) => (
        <>
          <MobileChrome />
          <QuickAdd defaults={state.quickAdd} onClose={() => close("quickAdd")} />
          <TaskDetailDialog selection={state.task ?? (linked ? { id: linked, order: [] } : null)}
            onClose={() => {
              if (linked) {
                const destination = new URL(route);
                destination.searchParams.delete("tarefa");
                browserRouter.replace(destination.href);
              }
              close("task");
            }} />
          {status.space.kind === "account" && <SyncStatus state={status.sync}
            label={t(syncLabels[status.sync]) + (status.pending ? ` · ${pendingLabel(status.pending)}` : "")} href="/ajustes#sincronizacao" />}
        </>
      )}
    >{screen}</AppShell>;
  }

  return <NavigationProvider pathname={pathname} router={browserRouter} Link={BrowserLink}>
    <AppProviders key={status.epoch} contextMenus>{page}</AppProviders>
    <UpdateNotice />
  </NavigationProvider>;
}

export function BrowserApp() {
  return <BrowserContent />;
}

import { SkipToContent, useT } from "@feito/ui/components/language";
import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { NavigationProvider } from "@feito/ui/navigation";
import { configureApi } from "@feito/ui/client/api";
import { applyTheme, AppProviders, AppShell } from "@feito/ui/components/app";
import { MobileChrome, Sidebar } from "@feito/ui/components/chrome";
import { QuickAdd } from "@feito/ui/components/quick-add";
import { Spinner } from "@feito/ui/components/ui";
import { TaskDetailDialog } from "@feito/ui/components/task-detail";
import { Browse, Inbox, Label, ProjectView, Search, Today, Upcoming } from "@feito/ui/screens/deferred";
import { lazyScreen } from "@feito/ui/components/lazy-screen";
import { openFailure, type OpenFailure } from "./data/desktop";
import { desktop, openPublicProject, watchServer } from "./data/native";
import { usePathname, useRoute, useRouter } from "./platform/navigation";
import Link from "./platform/link";
import { SyncStatus } from "@feito/ui/components/sync-status";
import { SpaceManager } from "./spaces";
import { StorageError } from "./storage-error";
import { detectTitlebar, Titlebar } from "./titlebar";
import "@feito/ui/globals.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/inter-tight/latin-600.css";
import "./desktop.css";

const DesktopSettings = lazyScreen(async () => ({ default: (await import("./settings")).DesktopSettings }));

const labels = new Map<string, Promise<{ id: string }>>();
const syncLabels = {
  current: "Sincronizado",
  syncing: "Sincronizando",
  disconnected: "Desconectado",
};

const routes: Record<string, ReactNode> = {
  "/hoje": <Today />,
  "/entrada": <Inbox />,
  "/em-breve": <Upcoming />,
  "/busca": <Search />,
  "/navegar": <Browse />,
  "/ajustes": <DesktopSettings />,
};

function WorkspaceScreen() {
  const t = useT();
  const route = useRoute();
  const router = useRouter();
  const status = useSyncExternalStore(desktop.subscribe, desktop.getStatus);
  const remoteOrigin = status.active === "server" && status.sync !== "login" ? status.server?.origin : undefined;
  const syncState = status.sync === "current" ? (status.server?.pending ? "syncing" : "current")
    : status.sync === "syncing" ? "syncing" : "disconnected";
  const [storageError, setStorageError] = useState<OpenFailure>();
  const openStorage = (open: () => Promise<void>) => {
    setStorageError(undefined);
    void open().then(() => desktop.sync(), (error: unknown) => setStorageError(openFailure(error)));
  };
  const initializeWorkspace = () => openStorage(desktop.initialize);
  const id = /^\/(projetos|etiquetas)\/([0-9a-f-]+)$/i.exec(route.pathname);
  const linked = route.searchParams.get("tarefa");
  let page = routes[route.pathname];
  if (id?.[1] === "projetos") page = <ProjectView key={id[2]} projectId={id[2]} sharing={remoteOrigin
    ? { origin: remoteOrigin, openPublicPage: (token) => openPublicProject(remoteOrigin, token) }
    : { unavailable: status.active === "server"
      ? t("Entre novamente no servidor para compartilhar este projeto.")
      : t("Conecte-se a um servidor para compartilhar este projeto.") }} />;
  if (id?.[1] === "etiquetas") {
    let params = labels.get(id[2]);
    if (!params) {
      params = Promise.resolve({ id: id[2] });
      labels.set(id[2], params);
    }
    page = <Suspense fallback={<Spinner label={t("Carregando etiqueta")} />}><Label key={id[2]} params={params} /></Suspense>;
  }

  useEffect(() => {
    const onReconnect = () => { void desktop.sync().catch(() => undefined); };
    initializeWorkspace();
    window.addEventListener("online", onReconnect);
    window.addEventListener("focus", onReconnect);
    return () => {
      window.removeEventListener("online", onReconnect);
      window.removeEventListener("focus", onReconnect);
    };
  }, []);

  useEffect(() => {
    if (!remoteOrigin) return;
    const watch = watchServer(remoteOrigin);
    const refresh = window.setInterval(() => {
      if (!watch.connected() || desktop.getStatus().sync !== "current") {
        void desktop.sync().catch(() => undefined);
      }
    }, 30_000);
    return () => {
      window.clearInterval(refresh);
      watch.close();
    };
  }, [remoteOrigin]);

  if (!status.ready) {
    return storageError
      ? <StorageError failure={storageError} onRetry={initializeWorkspace} onStartOver={() => openStorage(desktop.startOver)} />
      : <Spinner label={t("Carregando o Feito")} />;
  }
  if (status.active === "none") return (
    <main id="conteudo" className="desktop-space-start">
      <h1 className="title">Feito</h1>
      <SpaceManager status={status} />
    </main>
  );

  return (
    <AppShell key={status.active === "server" ? status.server?.origin : "local"} browserTools={false}
      renderChrome={(nav) => <Sidebar nav={nav} />}
      renderOverlays={(state, close) => (
        <>
          <MobileChrome />
          <QuickAdd defaults={state.quickAdd} onClose={() => close("quickAdd")} />
          <TaskDetailDialog selection={state.task ?? (linked ? { id: linked, order: [] } : null)} onClose={() => {
            if (linked) {
              const destination = new URL(route);
              destination.searchParams.delete("tarefa");
              router.replace(destination.pathname + destination.search + destination.hash);
            }
            close("task");
          }} />
          {status.active === "server" && (
            <SyncStatus state={syncState} label={t(syncLabels[syncState])} href="/ajustes" />
          )}
        </>
      )}
    >
      {page ?? routes["/hoje"]}
    </AppShell>
  );
}

try {
  const theme = localStorage.getItem("feito:theme");
  applyTheme(theme === "light" || theme === "dark" ? theme : "system");
} catch {
  applyTheme("system");
}
const titlebar = detectTitlebar();
if (titlebar) {
  document.documentElement.classList.add("desktop-overlay");
  document.documentElement.dataset.titlebar = titlebar;
}
configureApi({ fetch: desktop.fetch });
document.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });

function DesktopApp() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <NavigationProvider pathname={pathname} router={router} Link={Link}>
      <SkipToContent />
      {titlebar ? (
        <Titlebar platform={titlebar}><AppProviders contextMenus><WorkspaceScreen /></AppProviders></Titlebar>
      ) : <AppProviders contextMenus><WorkspaceScreen /></AppProviders>}
    </NavigationProvider>
  );
}

createRoot(document.getElementById("root")!).render(<DesktopApp />);

import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { NavigationProvider } from "@feito/ui/navigation";
import { configureApi } from "@feito/ui/client/api";
import { applyTheme, AppProviders, AppShell } from "@feito/ui/components/app";
import { MobileChrome, Sidebar } from "@feito/ui/components/chrome";
import { QuickAdd } from "@feito/ui/components/quick-add";
import { Spinner } from "@feito/ui/components/ui";
import { TaskDetailDialog } from "@feito/ui/components/task-detail";
import { ProjectView } from "@feito/ui/components/project-view";
import Today from "@feito/ui/screens/today";
import Upcoming from "@feito/ui/screens/upcoming";
import Inbox from "@feito/ui/screens/inbox";
import Search from "@feito/ui/screens/search";
import Browse from "@feito/ui/screens/browse";
import Label from "@feito/ui/screens/label";
import { desktop, openPublicProject, watchServer } from "./data/native";
import { usePathname, useRoute, useRouter } from "./platform/navigation";
import Link from "./platform/link";
import { DesktopSettings } from "./settings";
import { SpaceManager } from "./spaces";
import { detectTitlebar, Titlebar } from "./titlebar";
import "@feito/ui/globals.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/inter-tight/latin-600.css";
import "./desktop.css";

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
  const route = useRoute();
  const router = useRouter();
  const status = useSyncExternalStore(desktop.subscribe, desktop.getStatus);
  const remoteOrigin = status.active === "server" && status.sync !== "login" ? status.server?.origin : undefined;
  const syncState = status.sync === "current" ? (status.server?.pending ? "syncing" : "current")
    : status.sync === "syncing" ? "syncing" : "disconnected";
  const [storageError, setStorageError] = useState(false);
  const initializeWorkspace = () => {
    setStorageError(false);
    void desktop.initialize().then(() => desktop.sync(), () => setStorageError(true));
  };
  const id = /^\/(projetos|etiquetas)\/([0-9a-f-]+)$/i.exec(route.pathname);
  const linked = route.searchParams.get("tarefa");
  let page = routes[route.pathname];
  if (id?.[1] === "projetos") page = <ProjectView key={id[2]} projectId={id[2]} sharing={remoteOrigin
    ? { origin: remoteOrigin, openPublicPage: (token) => openPublicProject(remoteOrigin, token) }
    : { unavailable: status.active === "server"
      ? "Entre novamente no servidor para compartilhar este projeto."
      : "Conecte-se a um servidor para compartilhar este projeto." }} />;
  if (id?.[1] === "etiquetas") {
    let params = labels.get(id[2]);
    if (!params) {
      params = Promise.resolve({ id: id[2] });
      labels.set(id[2], params);
    }
    page = <Suspense fallback={<Spinner label="Carregando etiqueta" />}><Label key={id[2]} params={params} /></Suspense>;
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
    return storageError ? <main id="conteudo" className="desktop-space-start">
      <p role="alert">Não foi possível abrir os dados do Feito neste computador.</p>
      <button type="button" className="btn" onClick={initializeWorkspace}>Tentar de novo</button>
    </main> : <Spinner label="Carregando o Feito" />;
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
            <Link className="desktop-sync-status" data-sync={syncState} href="/ajustes"
              aria-label={`${syncLabels[syncState]}. Abrir ajustes`}>
              <span className="desktop-sync-label" aria-hidden="true">{syncLabels[syncState]}</span>
            </Link>
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
document.querySelector<HTMLAnchorElement>(".sr-only")?.addEventListener("click", (event) => {
  const main = document.getElementById("conteudo");
  if (!main) return;
  event.preventDefault();
  main.tabIndex = -1;
  main.focus();
});
function DesktopApp() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <NavigationProvider pathname={pathname} router={router} Link={Link}>
      {titlebar ? (
        <Titlebar platform={titlebar}><AppProviders contextMenus><WorkspaceScreen /></AppProviders></Titlebar>
      ) : <AppProviders contextMenus><WorkspaceScreen /></AppProviders>}
    </NavigationProvider>
  );
}

createRoot(document.getElementById("root")!).render(<DesktopApp />);

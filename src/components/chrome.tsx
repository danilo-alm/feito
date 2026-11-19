"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiFailure, errorMessage } from "@/client/api";
import { invalidate } from "@/client/store";
import type { Navigation, ProjectSummary } from "@/client/types";
import { useApp } from "./app";
import {
  IconArchive, IconBrowse, IconChevronLeft, IconChevronRight, IconEdit, IconGear, IconHash, IconInbox, IconMore, IconPlus,
  IconSearch, IconTag, IconToday, IconTrash, IconUpcoming, IconUpload, IconDownload, Logo,
} from "./icons";
import { useExportDialog } from "./export-dialog";
import { useImportDialog } from "./import-panel";
import { MenuButton, useToast, type MenuItem } from "./ui";

function NavLink({ href, icon, label, count, active }: { href: string; icon: ReactNode; label: string; count?: number; active: boolean }) {
  return (
    <Link href={href} className={`nav${active ? " on" : ""}`} aria-current={active ? "page" : undefined}>
      {icon}<span className="nav-name">{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </Link>
  );
}

export function Sidebar({ nav }: { nav: Navigation | undefined }) {
  const app = useApp();
  const pathname = usePathname();
  const is = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  const newProject = useNewProject();

  return (
    <nav className="side" aria-label="Navegação principal">
      <div className="brand"><Logo />Feito</div>
      <button type="button" className="side-add" onClick={() => app.openQuickAdd()}>
        <span className="plus"><IconPlus /></span>Adicionar tarefa<span className="kbd" style={{ marginLeft: "auto" }}>Q</span>
      </button>
      <Link href="/busca" className={`nav${is("/busca") ? " on" : ""}`} aria-current={is("/busca") ? "page" : undefined}>
        <IconSearch />Buscar<span className="kbd" style={{ marginLeft: "auto" }}>/</span>
      </Link>
      <NavLink href="/entrada" icon={<IconInbox />} label="Caixa de entrada" count={nav?.inbox.activeCount} active={is("/entrada")} />
      <NavLink href="/hoje" icon={<IconToday />} label="Hoje" count={nav?.todayCount} active={is("/hoje")} />
      <NavLink href="/em-breve" icon={<IconUpcoming />} label="Em breve" active={is("/em-breve")} />
      <div className="nav-label">
        Meus projetos
        <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={newProject} aria-label="Novo projeto">
          <IconPlus className="sm" />
        </button>
      </div>
      {nav?.projects.map((project) => (
        <ProjectRow key={project.id} project={project} active={is(`/projetos/${project.id}`)} />
      ))}
      {nav && !nav.projects.length && <p className="hint" style={{ padding: "2px 10px 6px" }}>Crie seu primeiro projeto com o +.</p>}
      {!!nav?.archivedCount && (
        <Link href="/ajustes#arquivados" className="nav" style={{ color: "var(--muted)" }}>
          <IconArchive />Arquivados<span className="count">{nav.archivedCount}</span>
        </Link>
      )}
      {!!nav?.labels.length && <div className="nav-label">Etiquetas</div>}
      {nav?.labels.map((label) => (
        <NavLink key={label.id} href={`/etiquetas/${label.id}`} icon={<IconTag />} label={label.name}
          count={label.activeCount} active={is(`/etiquetas/${label.id}`)} />
      ))}
      <div className="side-foot">
        <NavLink href="/ajustes" icon={<IconGear />} label="Ajustes" active={is("/ajustes")} />
      </div>
    </nav>
  );
}

function ProjectRow({ project, active }: { project: ProjectSummary; active: boolean }) {
  const app = useApp();
  const router = useRouter();
  const toast = useToast();
  const [importDialog, openImport] = useImportDialog();
  const [exportDialog, openExport] = useExportDialog();

  const menu = (): MenuItem[] => [
    { label: "Editar projeto", icon: <IconEdit />, onSelect: async () => {
      const name = await app.prompt({ title: "Editar projeto", label: "Nome do projeto", initial: project.name, confirmLabel: "Salvar" });
      if (name && name !== project.name) await app.run(() => api.projects.rename(project.id, project.revision, name), { success: "Projeto renomeado" });
    } },
    { label: "Importar…", icon: <IconUpload />, onSelect: () => openImport({ id: project.id, name: project.name }) },
    { label: "Exportar…", icon: <IconDownload />, onSelect: () => openExport({ id: project.id, name: project.name, activeCount: project.activeCount }) },
    { label: "Arquivar projeto", icon: <IconArchive />, onSelect: async () => {
      const ok = await app.confirm({
        title: `Arquivar “${project.name}”?`,
        body: "O projeto sai das listas, da busca e da agenda, com tarefas e estados guardados. Você pode reativar em Ajustes.",
        confirmLabel: "Arquivar",
      });
      if (ok && await app.run(() => api.projects.archive(project.id, project.revision), { success: "Projeto arquivado" }) && active) router.push("/hoje");
    } },
    "separator",
    { label: "Excluir projeto…", icon: <IconTrash />, danger: true, onSelect: async () => {
      const ok = await app.confirm({
        title: `Excluir “${project.name}”?`,
        body: "Só projetos sem tarefas, ativas ou concluídas, podem ser excluídos. Seções vazias vão junto.",
        confirmLabel: "Excluir projeto", danger: true,
      });
      if (!ok) return;
      try {
        await api.projects.remove(project.id, project.revision);
        toast("Projeto excluído");
        await invalidate();
        if (active) router.push("/hoje");
      } catch (error) {
        toast(error instanceof ApiFailure && error.code === "PROJECT_NOT_EMPTY"
          ? "O projeto ainda tem tarefas. Arquive-o ou mova as tarefas antes." : errorMessage(error), { bad: true });
      }
    } },
  ];

  return (
    <div className={`nav proj-row${active ? " on" : ""}`}>
      <Link href={`/projetos/${project.id}`} className="proj-link" aria-current={active ? "page" : undefined}>
        <IconHash /><span className="nav-name">{project.name}</span>
      </Link>
      {project.activeCount ? <span className="count">{project.activeCount}</span> : null}
      <MenuButton label={`Ações de ${project.name}`} title={project.name} items={menu} className="icon-btn proj-menu">
        <IconMore className="sm" />
      </MenuButton>
      {importDialog}
      {exportDialog}
    </div>
  );
}

function useNewProject() {
  const app = useApp();
  const router = useRouter();
  return async () => {
    const name = await app.prompt({ title: "Novo projeto", label: "Nome do projeto", confirmLabel: "Criar projeto" });
    if (!name) return;
    const project = await app.run(() => api.projects.create(name), { success: "Projeto criado" });
    if (project) router.push(`/projetos/${project.id}`);
  };
}

/** Rotas que pertencem à aba Navegar no celular. */
const BROWSE_ROUTES = ["/navegar", "/busca", "/projetos", "/etiquetas", "/ajustes"];

export function MobileChrome() {
  const app = useApp();
  const pathname = usePathname();
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const tab = (href: string, label: string, icon: ReactNode, active = under(href)) => (
    <Link href={href} className={`tab${active ? " on" : ""}`} aria-current={active ? "page" : undefined}>{icon}{label}</Link>
  );
  return (
    <>
      <button type="button" className="fab" aria-label="Adicionar tarefa" onClick={() => app.openQuickAdd()}><IconPlus /></button>
      <nav className="tabbar" aria-label="Navegação">
        {tab("/entrada", "Entrada", <IconInbox />)}
        {tab("/hoje", "Hoje", <IconToday />)}
        {tab("/em-breve", "Em breve", <IconUpcoming />)}
        {tab("/navegar", "Navegar", <IconBrowse />, BROWSE_ROUTES.some(under))}
      </nav>
    </>
  );
}

function BrowseRow({ href, icon, label, count }: { href: string; icon: ReactNode; label: string; count?: number }) {
  return (
    <li>
      <Link href={href} className="b-row">
        <span className="b-ico">{icon}</span>
        <span className="b-name">{label}</span>
        {count ? <span className="b-count">{count}</span> : null}
        <IconChevronRight className="b-chev" />
      </Link>
    </li>
  );
}

/** Aba Navegar do celular: busca, ajustes, projetos e etiquetas num só lugar. */
export function BrowsePanel() {
  const app = useApp();
  const nav = app.nav;
  const newProject = useNewProject();
  return (
    <div className="browse">
      <ul className="b-group" aria-label="Atalhos">
        <BrowseRow href="/busca" icon={<IconSearch />} label="Buscar" />
        <BrowseRow href="/ajustes" icon={<IconGear />} label="Ajustes" />
      </ul>

      <div className="b-head">
        <h2 id="b-projetos">Meus projetos</h2>
        <button type="button" className="icon-btn" onClick={newProject} aria-label="Novo projeto"><IconPlus /></button>
      </div>
      <ul className="b-group" aria-labelledby="b-projetos">
        {nav?.projects.map((project) => (
          <BrowseRow key={project.id} href={`/projetos/${project.id}`} icon={<IconHash />} label={project.name} count={project.activeCount} />
        ))}
        {nav && !nav.projects.length && (
          <li><button type="button" className="b-row" onClick={newProject}>
            <span className="b-ico"><IconPlus /></span><span className="b-name" style={{ color: "var(--muted)" }}>Criar o primeiro projeto</span>
          </button></li>
        )}
        {!!nav?.archivedCount && (
          <BrowseRow href="/ajustes#arquivados" icon={<IconArchive />} label="Projetos arquivados" count={nav.archivedCount} />
        )}
      </ul>

      {!!nav?.labels.length && (
        <>
          <div className="b-head"><h2 id="b-etiquetas">Etiquetas</h2></div>
          <ul className="b-group" aria-labelledby="b-etiquetas">
            {nav.labels.map((label) => (
              <BrowseRow key={label.id} href={`/etiquetas/${label.id}`} icon={<IconTag />} label={label.name} count={label.activeCount} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Cabeçalho da página: barra superior no desktop e barra fixa no celular. */
export function PageHeader({
  crumb, tools, mobileTools, mobileTitle, back,
}: {
  crumb?: ReactNode;
  tools?: ReactNode;
  mobileTools?: ReactNode;
  mobileTitle?: string;
  back?: string;
}) {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 56);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <>
      <div className="topbar">
        <div className="crumb">{crumb}</div>
        <div className="tools">{tools}</div>
      </div>
      <div className={`m-top${scrolled ? " scrolled" : ""}${back ? "" : " no-back"}`}>
        {back && <button type="button" className="icon-btn" aria-label="Voltar" onClick={() => router.push(back)}><IconChevronLeft /></button>}
        <span className="m-top-title" style={{ flex: 1, fontWeight: 700, fontSize: 17, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} aria-hidden={!scrolled}>{mobileTitle}</span>
        {mobileTools ?? tools}
      </div>
    </>
  );
}

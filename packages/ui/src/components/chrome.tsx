"use client";
import { useT } from "./language";

import { Link } from "../navigation";
import { usePathname, useRouter } from "../navigation";
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTitlebar } from "./titlebar";
import { api, ApiFailure, errorMessage } from "../client/api";
import { tagColor } from "../client/colors";
import { invalidate } from "../client/store";
import type { Label, Navigation, OrderAnchor, ProjectMove, ProjectSummary } from "@feito/core/types";
import { moveInOrder, moveInTree, treeStep, type OrderKind } from "../client/manual-order";
import { isDragging, PROJECT_SHORTCUT_KEYS, refreshProjects, useApp } from "./app";
import {
  IconArchive, IconArrowDown, IconArrowUp, IconBrowse, IconCheckCircle, IconChevronLeft, IconChevronRight, IconEdit, IconGear, IconInbox, IconMore, IconPlus,
  IconPromote, IconSearch, IconSub, IconTag, IconToday, IconTrash, IconUpcoming, IconUpload, IconDownload,
} from "./icons";
import { ProjectGlyph } from "./project-style";
import { useExportDialog, useImportDialog } from "./import-export-dialogs";
import { useProjectDetailsDialog } from "./named-details";
import { useLabelMenu } from "./label-actions";
import { useFlip } from "./motion";
import { ReorderList, type ReorderHandle } from "./reorder";
import { MenuButton, useContextMenu, useToast, type MenuItem } from "./ui";
import { SidebarName, useSidebarResize } from "./sidebar-resize";

export function PageTaskCount({ count, more = false }: { count: number; more?: boolean }) {
  const t = useT();
  return (
    <span className="sub page-count">
      <IconCheckCircle />{count}{more ? "+" : ""} {count === 1 && !more ? t("tarefa") : t("tarefas")}
    </span>
  );
}

const refreshOrder = (key: string) => key === "nav" || key === "labels";

/**
 * Reordena projetos ou etiquetas com atualização otimista; a barra lateral e a aba Navegar usam a mesma ordem.
 * Projetos podem trocar de projeto principal no mesmo movimento.
 */
function useManualOrder() {
  const app = useApp();
  return (kind: OrderKind) => (item: { id: string }, anchor: ProjectMove, order: string[]) => {
    const send = kind === "projects"
      ? () => api.projects.move(item.id, anchor).then((result) => result.projectIds)
      : () => api.labels.move(item.id, anchor).then((result) => result.labelIds);
    const parent = kind === "projects" && anchor.parentId !== undefined ? { id: item.id, parentId: anchor.parentId } : undefined;
    void app.run(() => moveInOrder(kind, order, send, parent), { revalidate: refreshOrder });
  };
}

const projectParent = (project: ProjectSummary) => project.parentId;

/** Itens do menu de ações de um projeto: subir, descer e mudar de nível sem arrastar. */
function projectOrderMenu(
  t: ReturnType<typeof useT>, projects: readonly ProjectSummary[], project: ProjectSummary,
  onMove: (item: ProjectSummary, anchor: ProjectMove, order: string[]) => void,
): MenuItem[] {
  const step = (direction: "up" | "down" | "in" | "out") => {
    const placement = treeStep(projects, project.id, direction);
    return {
      disabled: !placement,
      onSelect: () => placement && onMove(project, placement, moveInTree(projects, project.id, placement).map((item) => item.id)),
    };
  };
  const parent = projects.find((candidate) => candidate.id === project.parentId);
  return [
    { label: t("Mover para cima"), icon: <IconArrowUp />, ...step("up") },
    { label: t("Mover para baixo"), icon: <IconArrowDown />, ...step("down") },
    { label: t("Tornar subprojeto do anterior"), icon: <IconSub />, ...step("in") },
    ...parent ? [{ label: t("Tirar de “{0}”", [parent.name]), icon: <IconPromote />, ...step("out") }] : [],
  ];
}

/** Itens “Mover para cima/baixo” do menu de ações: alternativa ao arraste. */
function orderMenu<T extends { id: string }>(
  t: ReturnType<typeof useT>, items: readonly T[], item: T, onMove: (item: T, anchor: OrderAnchor, order: string[]) => void,
): MenuItem[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  const others = items.filter((candidate) => candidate.id !== item.id).map((candidate) => candidate.id);
  const moveTo = (target: number) => {
    const order = [...others];
    order.splice(target, 0, item.id);
    onMove(item, target > 0 ? { afterId: others[target - 1] } : { beforeId: others[0] }, order);
  };
  return [
    { label: t("Mover para cima"), icon: <IconArrowUp />, disabled: index <= 0, onSelect: () => moveTo(index - 1) },
    { label: t("Mover para baixo"), icon: <IconArrowDown />, disabled: index < 0 || index >= items.length - 1, onSelect: () => moveTo(index + 1) },
  ];
}

function NavLink({ href, icon, label, count, active }: { href: string; icon: ReactNode; label: string; count?: number; active: boolean }) {
  return (
    <Link href={href} className={`nav${active ? " on" : ""}`} aria-current={active ? "page" : undefined}>
      {icon}<SidebarName>{label}</SidebarName>
      {count ? <span className="count">{count}</span> : null}
    </Link>
  );
}

export function Sidebar({ nav }: { nav: Navigation | undefined }) {
  const t = useT();
  const app = useApp();
  const pathname = usePathname();
  const is = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  const projectDetails = useProjectDetailsDialog();
  const { sidebar, handle } = useSidebarResize();
  const manualOrder = useManualOrder();
  const moveProject = manualOrder("projects");
  const moveLabel = manualOrder("labels");
  const instructions = t("Para reordenar sem arrastar, use Alt e as setas para cima e para baixo.");
  const projectInstructions = t("Para reordenar sem arrastar, use Alt e as setas. Alt e as setas para os lados mudam o projeto principal.");
  useFlip(sidebar, { paused: isDragging });

  return (
    <><nav ref={sidebar} className="side" aria-label={t("Navegação principal")}>
      <button type="button" className="side-add" onClick={() => app.openQuickAdd()}>
        <span className="plus"><IconPlus /></span><span className="side-add-label">{t("Adicionar tarefa")}</span><span className="kbd" style={{ marginLeft: "auto" }}>Q</span>
      </button>
      <Link href="/busca" className={`nav nav-search${is("/busca") ? " on" : ""}`} aria-current={is("/busca") ? "page" : undefined}>
        <IconSearch /><SidebarName>{t("Buscar")}</SidebarName><span className="kbd" style={{ marginLeft: "auto" }}>/</span>
      </Link>
      <NavLink href="/entrada" icon={<IconInbox />} label={t("Entrada")} count={nav?.inbox.activeCount} active={is("/entrada")} />
      <NavLink href="/hoje" icon={<IconToday />} label={t("Hoje")} count={nav?.todayCount} active={is("/hoje")} />
      <NavLink href="/em-breve" icon={<IconUpcoming />} label={t("Em breve")} active={is("/em-breve")} />
      {/* Só projetos e etiquetas rolam: o topo e os Ajustes ficam sempre à vista. */}
      <div className="side-scroll">
        <div className="nav-label">
          {t("Meus projetos")}<button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={projectDetails.create} aria-label={t("Novo projeto")}>
            <IconPlus className="sm" />
          </button>
        </div>
        {nav && (
          <ReorderList items={nav.projects} onMove={moveProject} instructions={projectInstructions} tree={projectParent}
            renderItem={(project, reorder) => (
              <ProjectRow project={project} active={is(`/projetos/${project.id}`)} reorder={reorder}
                shortcut={PROJECT_SHORTCUT_KEYS[nav.projects.indexOf(project)]}
                onEdit={() => projectDetails.edit(project)} orderMenu={() => projectOrderMenu(t, nav.projects, project, moveProject)} />
            )}
            renderOverlay={(project) => <ProjectRow project={project} active={false} onEdit={() => {}} orderMenu={() => []} />} />
        )}
        {nav && !nav.projects.length && <p className="hint" style={{ padding: "2px 10px 6px" }}>{t("Crie seu primeiro projeto com o +.")}</p>}
        {!!nav?.archivedCount && (
          <Link href="/ajustes#arquivados" className="nav" style={{ color: "var(--muted)" }}>
            <IconArchive /><SidebarName>{t("Arquivados")}</SidebarName><span className="count">{nav.archivedCount}</span>
          </Link>
        )}
        {!!nav?.labels.length && <div className="nav-label">{t("Etiquetas")}</div>}
        {nav && (
          <ReorderList items={nav.labels} onMove={moveLabel} instructions={instructions}
            renderItem={(label, reorder) => (
              <LabelRow label={label} active={is(`/etiquetas/${label.id}`)} reorder={reorder}
                orderMenu={() => orderMenu(t, nav.labels, label, moveLabel)} />
            )}
            renderOverlay={(label) => <LabelRow label={label} active={false} orderMenu={() => []} />} />
        )}
      </div>
      <div className="side-foot">
        <NavLink href="/ajustes" icon={<IconGear />} label={t("Ajustes")} active={is("/ajustes")} />
      </div>
      {projectDetails.dialog}
    </nav>{handle}</>
  );
}

const TREE_KEYS = "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight";

function ProjectShortcut({ keyNumber }: { keyNumber: string }) {
  return <kbd className="kbd project-shortcut" aria-hidden="true">^{keyNumber}</kbd>;
}

/** Propriedades da linha reordenável da barra lateral, com o menu de contexto do app. */
function rowProps(reorder: ReorderHandle | undefined, onContextMenu?: (event: MouseEvent<HTMLElement>) => void) {
  if (!reorder) return { onContextMenu };
  return {
    ...reorder.props,
    ref: reorder.ref,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      // Durante o arraste por toque prolongado, nenhum menu abre.
      if (isDragging()) reorder.props.onContextMenu(event);
      else onContextMenu?.(event);
    },
  };
}

function LabelRow({ label, active, reorder, orderMenu }: {
  label: Label; active: boolean; reorder?: ReorderHandle; orderMenu: () => MenuItem[];
}) {
  const t = useT();
  const contextMenu = useContextMenu();
  const labelMenu = useLabelMenu(label, active);
  const menu = (): MenuItem[] => {
    const [rename, ...rest] = labelMenu();
    const order = orderMenu();
    return order.length ? [rename, ...order, ...rest] : [rename, ...rest];
  };

  return (
    <div className={`nav proj-row${active ? " on" : ""}${reorder?.dragging ? " drag-src" : ""}`}
      {...rowProps(reorder, contextMenu.onContextMenu)}>
      <Link href={`/etiquetas/${label.id}`} className="proj-link" aria-current={active ? "page" : undefined} draggable={false}
        aria-keyshortcuts={reorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined}>
        <IconTag style={{ color: tagColor(label.id) }} /><SidebarName>{label.name}</SidebarName>
      </Link>
      {label.activeCount ? <span className="count">{label.activeCount}</span> : null}
      <MenuButton label={t("Ações de {0}", [label.name])} title={label.name} items={menu} className="icon-btn proj-menu" contextMenu={contextMenu}>
        <IconMore className="sm" />
      </MenuButton>
    </div>
  );
}

function ProjectRow({ project, active, shortcut, onEdit, reorder, orderMenu }: {
  project: ProjectSummary; active: boolean; shortcut?: string; onEdit: () => void; reorder?: ReorderHandle; orderMenu: () => MenuItem[];
}) {
  const t = useT();
  const app = useApp();
  const contextMenu = useContextMenu();
  const router = useRouter();
  const toast = useToast();
  const [importDialog, openImport] = useImportDialog();
  const [exportDialog, openExport] = useExportDialog();

  const menu = (): MenuItem[] => [
    { label: t("Editar projeto"), icon: <IconEdit />, onSelect: onEdit },
    ...orderMenu(),
    ...(app.browserTools ? [
      { label: t("Importar…"), icon: <IconUpload />, onSelect: () => openImport({ id: project.id, name: project.name }) },
      { label: t("Exportar…"), icon: <IconDownload />, onSelect: () => openExport({ id: project.id, name: project.name, activeCount: project.activeCount }) },
    ] : []),
    { label: t("Arquivar projeto"), icon: <IconArchive />, onSelect: async () => {
      const ok = await app.confirm({
        title: t("Arquivar “{0}”?", [project.name]),
        body: t("O projeto sai das listas, da busca e da agenda, com tarefas e estados guardados. Você pode reativar em Ajustes."),
        confirmLabel: t("Arquivar"),
      });
      if (ok && await app.run(() => api.projects.archive(project.id, project.revision), { success: t("Projeto arquivado"), revalidate: refreshProjects }) && active) router.push("/hoje");
    } },
    "separator",
    { label: t("Excluir projeto…"), icon: <IconTrash />, danger: true, onSelect: async () => {
      const ok = await app.confirm({
        title: t("Excluir “{0}”?", [project.name]),
        body: t("Só projetos sem tarefas, ativas ou concluídas, podem ser excluídos. Seções vazias vão junto."),
        confirmLabel: t("Excluir projeto"), danger: true,
      });
      if (!ok) return;
      try {
        await api.projects.remove(project.id, project.revision);
        toast(t("Projeto excluído"));
        await invalidate(refreshProjects);
        if (active) router.push("/hoje");
      } catch (error) {
        toast(error instanceof ApiFailure && error.code === "PROJECT_NOT_EMPTY"
          ? t("O projeto ainda tem tarefas. Arquive-o ou mova as tarefas antes.") : errorMessage(error), { bad: true });
      }
    } },
  ];

  return (
    <div className={`nav proj-row tree-row${active ? " on" : ""}${reorder?.dragging ? " drag-src" : ""}`}
      style={reorder?.depth ? { "--depth": reorder.depth } as CSSProperties : undefined}
      {...rowProps(reorder, contextMenu.onContextMenu)}>
      <Link href={`/projetos/${project.id}`} className="proj-link" aria-current={active ? "page" : undefined} draggable={false}
        aria-keyshortcuts={[shortcut && `Control+${shortcut}`, reorder && TREE_KEYS].filter(Boolean).join(" ") || undefined}>
        <ProjectGlyph id={project.id} /><SidebarName>{project.name}</SidebarName>
      </Link>
      {app.showProjectShortcuts && shortcut ? <ProjectShortcut keyNumber={shortcut} />
        : project.activeCount ? <span className="count">{project.activeCount}</span> : null}
      <MenuButton label={t("Ações de {0}", [project.name])} title={project.name} items={menu} className="icon-btn proj-menu" contextMenu={contextMenu}>
        <IconMore className="sm" />
      </MenuButton>
      {importDialog}
      {exportDialog}
    </div>
  );
}

/** Rotas que pertencem à aba Navegar no celular. */
const BROWSE_ROUTES = ["/navegar", "/busca", "/projetos", "/etiquetas", "/ajustes"];

export function MobileChrome() {
  const t = useT();
  const app = useApp();
  const pathname = usePathname();
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const tab = (href: string, label: string, icon: ReactNode, active = under(href)) => (
    <Link href={href} className={`tab${active ? " on" : ""}`} aria-current={active ? "page" : undefined}>{icon}{label}</Link>
  );
  return (
    <>
      <button type="button" className="fab" aria-label={t("Adicionar tarefa")} onClick={() => app.openQuickAdd()}><IconPlus /></button>
      <nav className="tabbar" aria-label={t("Navegação")}>
        {tab("/entrada", t("Entrada"), <IconInbox />)}
        {tab("/hoje", t("Hoje"), <IconToday />)}
        {tab("/em-breve", t("Em breve"), <IconUpcoming />)}
        {tab("/navegar", t("Navegar"), <IconBrowse />, BROWSE_ROUTES.some(under))}
      </nav>
    </>
  );
}

function BrowseRow({ href, icon, label, count, shortcut, reorder, tree = false }: {
  href: string; icon: ReactNode; label: string; count?: number; shortcut?: string; reorder?: ReorderHandle; tree?: boolean;
}) {
  const { showProjectShortcuts } = useApp();
  return (
    <li ref={reorder?.ref} {...reorder?.props} className={[tree && "tree-row", reorder?.dragging && "drag-src"].filter(Boolean).join(" ") || undefined}
      style={reorder?.depth ? { "--depth": reorder.depth } as CSSProperties : undefined}>
      <Link href={href} className="b-row" draggable={reorder ? false : undefined}
        aria-keyshortcuts={[shortcut && `Control+${shortcut}`, reorder && (tree ? TREE_KEYS : "Alt+ArrowUp Alt+ArrowDown")].filter(Boolean).join(" ") || undefined}>
        <span className="b-ico">{icon}</span>
        <span className="b-name">{label}</span>
        {showProjectShortcuts && shortcut ? <ProjectShortcut keyNumber={shortcut} />
          : count ? <span className="b-count">{count}</span> : null}
        <IconChevronRight className="b-chev" />
      </Link>
    </li>
  );
}

/** Aba Navegar do celular: busca, ajustes, projetos e etiquetas num só lugar. */
export function BrowsePanel() {
  const t = useT();
  const app = useApp();
  const nav = app.nav;
  const projectDetails = useProjectDetailsDialog();
  const manualOrder = useManualOrder();
  const instructions = t("Para reordenar sem arrastar, use Alt e as setas para cima e para baixo.");
  return (
    <div className="browse">
      <ul className="b-group" aria-label={t("Atalhos")}>
        <BrowseRow href="/busca" icon={<IconSearch />} label={t("Buscar")} />
        <BrowseRow href="/ajustes" icon={<IconGear />} label={t("Ajustes")} />
      </ul>

      <div className="b-head">
        <h2 id="b-projetos">{t("Meus projetos")}</h2>
        <button type="button" className="icon-btn" onClick={projectDetails.create} aria-label={t("Novo projeto")}><IconPlus /></button>
      </div>
      <ul className="b-group" aria-labelledby="b-projetos">
        {nav && (
          <ReorderList items={nav.projects} onMove={manualOrder("projects")} tree={projectParent}
            instructions={t("Para reordenar sem arrastar, use Alt e as setas. Alt e as setas para os lados mudam o projeto principal.")}
            renderItem={(project, reorder) => (
              <BrowseRow href={`/projetos/${project.id}`} icon={<ProjectGlyph id={project.id} />} label={project.name} tree
                count={project.activeCount} shortcut={PROJECT_SHORTCUT_KEYS[nav.projects.indexOf(project)]} reorder={reorder} />
            )}
            renderOverlay={(project) => (
              <ul className="b-group"><BrowseRow href={`/projetos/${project.id}`} icon={<ProjectGlyph id={project.id} />}
                label={project.name} count={project.activeCount} /></ul>
            )} />
        )}
        {nav && !nav.projects.length && (
          <li><button type="button" className="b-row" onClick={projectDetails.create}>
            <span className="b-ico"><IconPlus /></span><span className="b-name" style={{ color: "var(--muted)" }}>{t("Criar o primeiro projeto")}</span>
          </button></li>
        )}
        {!!nav?.archivedCount && (
          <BrowseRow href="/ajustes#arquivados" icon={<IconArchive />} label={t("Projetos arquivados")} count={nav.archivedCount} />
        )}
      </ul>
      {projectDetails.dialog}

      {!!nav?.labels.length && (
        <>
          <div className="b-head"><h2 id="b-etiquetas">{t("Etiquetas")}</h2></div>
          <ul className="b-group" aria-labelledby="b-etiquetas">
            <ReorderList items={nav.labels} onMove={manualOrder("labels")} instructions={instructions}
              renderItem={(label, reorder) => (
                <BrowseRow href={`/etiquetas/${label.id}`} icon={<IconTag style={{ color: tagColor(label.id) }} />} label={label.name}
                  count={label.activeCount} reorder={reorder} />
              )}
              renderOverlay={(label) => (
                <ul className="b-group"><BrowseRow href={`/etiquetas/${label.id}`} icon={<IconTag style={{ color: tagColor(label.id) }} />}
                  label={label.name} count={label.activeCount} /></ul>
              )} />
          </ul>
        </>
      )}
    </div>
  );
}

/** Cabeçalho da página: barra superior no desktop e barra fixa no celular. */
export function PageHeader({
  crumb, tools, mobileTools, mobileTitle, compactTitle, back, title,
}: {
  crumb?: ReactNode;
  tools?: ReactNode;
  mobileTools?: ReactNode;
  mobileTitle?: string;
  compactTitle?: ReactNode;
  back?: string;
  /** Título da tela na faixa do desktop; sem ele, vale o mobileTitle. */
  title?: string;
}) {
  const t = useT();
  const router = useRouter();
  const titlebar = useTitlebar();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (titlebar) return;
    const onScroll = () => setScrolled(window.scrollY > 56);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [titlebar]);
  if (titlebar) {
    const label = title ?? mobileTitle;
    return (
      <>
        {titlebar.title && createPortal(compactTitle || (label ? (
          <span className="compact-title" aria-hidden={!titlebar.scrolled}><span>{label}</span></span>
        ) : null), titlebar.title)}
        {titlebar.tools && createPortal(<>
          <div className="tools tb-tools-wide">{tools}</div>
          <div className="tools tb-tools-compact">{mobileTools ?? tools}</div>
        </>, titlebar.tools)}
      </>
    );
  }
  return (
    <>
      <div className="topbar">
        <div className="crumb">{crumb}</div>
        {compactTitle}
        <div className="tools">{tools}</div>
      </div>
      <div className={`m-top${scrolled ? " scrolled" : ""}${back ? "" : " no-back"}`}>
        {back && <button type="button" className="icon-btn" aria-label={t("Voltar")} onClick={() => router.push(back)}><IconChevronLeft /></button>}
        {compactTitle ? <>
          {compactTitle}
          <div className="tools">{mobileTools ?? tools}</div>
        </> : <>
          <span className="m-top-title" style={{ flex: 1, fontWeight: 700, fontSize: 17, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} aria-hidden={!scrolled}>{mobileTitle}</span>
          {mobileTools ?? tools}
        </>}
      </div>
    </>
  );
}

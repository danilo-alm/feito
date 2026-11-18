"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/client/api";
import type { Navigation } from "@/client/types";
import { useApp } from "./app";
import {
  IconArchive, IconChevronLeft, IconGear, IconHash, IconInbox, IconMenu, IconPlus, IconSearch, IconTag, IconToday,
  IconUpcoming, IconX, Logo,
} from "./icons";

function NavLink({ href, icon, label, count, active }: { href: string; icon: ReactNode; label: string; count?: number; active: boolean }) {
  return (
    <Link href={href} className={`nav${active ? " on" : ""}`} aria-current={active ? "page" : undefined}>
      {icon}<span className="nav-name">{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </Link>
  );
}

export function Sidebar({ nav, inDrawer, onClose }: { nav: Navigation | undefined; inDrawer?: boolean; onClose?: () => void }) {
  const app = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const is = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  const newProject = async () => {
    const name = await app.prompt({ title: "Novo projeto", label: "Nome do projeto", confirmLabel: "Criar projeto" });
    if (!name) return;
    const project = await app.run(() => api.projects.create(name), { success: "Projeto criado" });
    if (project) router.push(`/projetos/${project.id}`);
  };

  return (
    <nav className="side" aria-label="Navegação principal">
      <div className="brand" style={inDrawer ? { justifyContent: "space-between" } : undefined}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Logo />Feito</span>
        {inDrawer && <button type="button" className="icon-btn" style={{ width: 44, height: 44 }} onClick={onClose} aria-label="Fechar navegação"><IconX /></button>}
      </div>
      {!inDrawer && (
        <button type="button" className="side-add" onClick={() => app.openQuickAdd()}>
          <span className="plus"><IconPlus /></span>Adicionar tarefa<span className="kbd" style={{ marginLeft: "auto" }}>Q</span>
        </button>
      )}
      {!inDrawer && (
        <Link href="/busca" className={`nav${is("/busca") ? " on" : ""}`} aria-current={is("/busca") ? "page" : undefined}>
          <IconSearch />Buscar<span className="kbd" style={{ marginLeft: "auto" }}>/</span>
        </Link>
      )}
      <NavLink href="/entrada" icon={<IconInbox />} label="Caixa de entrada" count={nav?.inbox.activeCount} active={is("/entrada")} />
      <NavLink href="/hoje" icon={<IconToday />} label="Hoje" count={nav?.todayCount} active={is("/hoje")} />
      <NavLink href="/em-breve" icon={<IconUpcoming />} label="Em breve" active={is("/em-breve")} />
      <div className="nav-label">
        Meus projetos
        <button type="button" className="icon-btn" style={{ width: inDrawer ? 44 : 28, height: inDrawer ? 44 : 28 }} onClick={newProject} aria-label="Novo projeto">
          <IconPlus className="sm" />
        </button>
      </div>
      {nav?.projects.map((project) => (
        <NavLink key={project.id} href={`/projetos/${project.id}`} icon={<IconHash />} label={project.name}
          count={project.activeCount} active={is(`/projetos/${project.id}`)} />
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

export function MobileChrome() {
  const app = useApp();
  const pathname = usePathname();
  const tab = (href: string, label: string, icon: ReactNode) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link href={href} className={`tab${active ? " on" : ""}`} aria-current={active ? "page" : undefined}>{icon}{label}</Link>
    );
  };
  const inProject = pathname.startsWith("/projetos/") || pathname.startsWith("/etiquetas/");
  return (
    <>
      <button type="button" className="fab" aria-label="Adicionar tarefa" onClick={() => app.openQuickAdd()}><IconPlus /></button>
      <nav className="tabbar" aria-label="Navegação">
        {tab("/entrada", "Entrada", <IconInbox />)}
        {tab("/hoje", "Hoje", <IconToday />)}
        {tab("/em-breve", "Em breve", <IconUpcoming />)}
        {tab("/busca", "Buscar", <IconSearch />)}
        <button type="button" className={`tab${inProject ? " on" : ""}`} style={{ border: 0, background: "none" }} onClick={app.openDrawer}>
          <IconHash />Projetos
        </button>
      </nav>
    </>
  );
}

export function Drawer({ nav: given, open, onClose }: { nav: Navigation | undefined; open: boolean; onClose: () => void }) {
  const app = useApp();
  const nav = given ?? app.nav;
  if (!open) return null;
  return (
    <div className="mobile-only">
      <div className="scrim" style={{ position: "fixed", zIndex: 55 }} onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Navegação e projetos"
        onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
        <Sidebar nav={nav} inDrawer onClose={onClose} />
      </div>
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
  const app = useApp();
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
      <div className={`m-top${scrolled ? " scrolled" : ""}`}>
        {back ? (
          <button type="button" className="icon-btn" aria-label="Voltar" onClick={() => router.push(back)}><IconChevronLeft /></button>
        ) : (
          <button type="button" className="icon-btn" aria-label="Abrir navegação" onClick={app.openDrawer}><IconMenu /></button>
        )}
        <span style={{ flex: 1, fontWeight: 700, fontSize: 17, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} aria-hidden={!scrolled}>{scrolled ? mobileTitle : ""}</span>
        {mobileTools ?? tools}
      </div>
    </>
  );
}

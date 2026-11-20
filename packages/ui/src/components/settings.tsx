"use client";
import { Link } from "../navigation";
import { type ReactNode } from "react";
import { api } from "../client/api";
import { setQueryData, useQuery } from "../client/store";
import type { Me, ProjectSummary, Theme } from "@feito/core/types";
import { applyTheme, refreshProjects, useApp } from "./app";
import {
  IconChevronRight, IconClock, IconHash, IconMonitor, IconMoon, IconSun,
} from "./icons";
import { TimezonePicker } from "./timezone-picker";
import { ReadFallback } from "./ui";

// Ajustes em grupos de linhas: ícone, nome e explicação à esquerda, controle à direita.
// O web e o desktop montam a página com os mesmos grupos; o desktop acrescenta os espaços de trabalho.

export function SettingsGroup({ id, title, children, footer }: { id: string; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section id={id} className="set-group" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
      {footer && <p className="set-foot">{footer}</p>}
    </section>
  );
}

type Tone = "brand" | "danger";
type RowContent = { icon: ReactNode; label: ReactNode; hint?: ReactNode; tone?: Tone; labelFor?: string };

function RowText({ icon, label, hint, tone, labelFor }: RowContent) {
  const labelClass = `set-label${tone ? ` tone-${tone}` : ""}`;
  return (
    <>
      <span className={`set-icon${tone ? ` tone-${tone}` : ""}`} aria-hidden="true">{icon}</span>
      <span className="set-text">
        {labelFor ? <label htmlFor={labelFor} className={labelClass}>{label}</label> : <span className={labelClass}>{label}</span>}
        {hint && <span className="hint">{hint}</span>}
      </span>
    </>
  );
}

/** Linha com controle à direita. `extra` ocupa a largura toda abaixo (prévias, formulários, avisos). */
export function SettingsRow({ control, extra, ...content }: RowContent & { control?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="set-row">
      <RowText {...content} />
      {control && <div className="set-control">{control}</div>}
      {extra && <div className="set-extra">{extra}</div>}
    </div>
  );
}

/** Linha inteira clicável: leva a outra tela ou abre um diálogo. */
export function SettingsLinkRow({ href, onClick, trailing, ...content }: RowContent & {
  href?: string; onClick?: () => void; trailing?: ReactNode;
}) {
  const inner = <><RowText {...content} />{trailing ?? <IconChevronRight className="set-chev" />}</>;
  return href
    ? <Link className="set-row set-link" href={href}>{inner}</Link>
    : <button type="button" className="set-row set-link" onClick={onClick}>{inner}</button>;
}

const THEMES: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Claro", icon: <IconSun /> },
  { value: "dark", label: "Escuro", icon: <IconMoon /> },
  { value: "system", label: "Sistema", icon: <IconMonitor /> },
];

function useSavePreferences() {
  const app = useApp();
  return async (patch: { theme?: Theme; timezone?: string }) => {
    if (patch.theme) applyTheme(patch.theme);
    const saved = await app.run(() => api.preferences(patch), {
      success: patch.timezone ? "Fuso horário atualizado" : undefined,
      revalidate: patch.timezone ? (key) => key === "me" || refreshProjects(key) : undefined,
    });
    if (saved) setQueryData<Me>("me", (me) => me && { ...me, preferences: saved });
  };
}

export function AppearanceSettings() {
  const app = useApp();
  const save = useSavePreferences();
  return (
    <SettingsGroup id="aparencia" title="Aparência">
      <div className="set-card">
        <SettingsRow icon={<IconMonitor />} label="Tema" hint="Claro, escuro ou igual ao sistema." control={
          <div className="seg compact" role="radiogroup" aria-label="Tema">
            {THEMES.map((theme) => (
              <button key={theme.value} type="button" role="radio" aria-checked={app.me.preferences.theme === theme.value}
                className={`seg-o${app.me.preferences.theme === theme.value ? " on" : ""}`}
                onClick={() => void save({ theme: theme.value })}>
                {theme.icon}{theme.label}
              </button>
            ))}
          </div>
        } />
      </div>
    </SettingsGroup>
  );
}

export function AgendaSettings() {
  const app = useApp();
  const save = useSavePreferences();
  return (
    <SettingsGroup id="agenda" title="Agenda">
      <div className="set-card">
        <SettingsRow icon={<IconClock />} label="Fuso horário do perfil" labelFor="tz"
          hint="Define o que é “Hoje” e quando uma tarefa fica atrasada."
          control={<TimezonePicker id="tz" value={app.timezone} onChange={(timezone) => void save({ timezone })} />} />
      </div>
    </SettingsGroup>
  );
}

export function ArchivedSettings() {
  const app = useApp();
  const archived = useQuery<{ projects: ProjectSummary[] }>("archived", () => api.projects.list("archived"));
  return (
    <SettingsGroup id="arquivados" title="Projetos arquivados">
      <div className="set-card">
        {!archived.data && <div className="set-row"><ReadFallback error={archived.error} loading={archived.loading} onRetry={archived.reload} /></div>}
        {archived.data?.projects.length === 0 && <div className="set-row"><span className="hint">Nenhum projeto arquivado.</span></div>}
        {archived.data?.projects.map((project) => (
          <SettingsRow key={project.id} icon={<IconHash />} label={<Link href={`/projetos/${project.id}`}>{project.name}</Link>} control={
            <button type="button" className="btn" onClick={() => void app.run(() => api.projects.unarchive(project.id, project.revision), {
              success: `“${project.name}” reativado`, revalidate: refreshProjects,
            })}>Reativar</button>
          } />
        ))}
      </div>
    </SettingsGroup>
  );
}

"use client";
import { defaultLocale } from "@feito/core/domain/preferences";
import { useT } from "./language";
import { loadLocale } from "../client/locale";

import { LanguagePicker } from "./language-picker";
import { Link } from "../navigation";
import { type ReactNode } from "react";
import { api } from "../client/api";
import { cacheScope, setQueryData, useQuery } from "../client/store";
import { setSyncIndicatorHidden, useSyncIndicatorHidden } from "../client/sync-indicator";
import type { Me, ProjectSummary, Preferences } from "@feito/core/types";
import { refreshProjects, useApp } from "./app";
import {
  IconChevronRight, IconClock, IconHash, IconMonitor, IconMoon, IconRepeat, IconSun,
} from "./icons";
import { TimezonePicker } from "./timezone-picker";
import { ReadFallback } from "./ui";

// Ajustes em grupos de linhas: ícone, nome e explicação à esquerda, controle à direita.
// O web e o desktop montam a página com os mesmos grupos; o desktop acrescenta os espaços de trabalho.

export function SettingsVersion({ version }: { version: string }) {
  const t = useT();
  return <p className="set-foot">Feito · {t("Versão")} {version}</p>;
}

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

const THEMES: { value: Preferences["theme"]; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Claro", icon: <IconSun /> },
  { value: "dark", label: "Escuro", icon: <IconMoon /> },
  { value: "system", label: "Sistema", icon: <IconMonitor /> },
];

function useSavePreferences() {
  const t = useT();
  const app = useApp();
  return async (patch: Partial<Preferences>) => {
    const saved = await app.run(async () => {
      const scope = cacheScope();
      if (patch.locale) await loadLocale(patch.locale);
      if (scope !== cacheScope()) return undefined;
      return api.preferences(patch);
    }, {
      success: patch.timezone ? t("Fuso horário atualizado") : undefined,
      revalidate: patch.timezone ? (key) => key === "me" || refreshProjects(key) : undefined,
    });
    if (saved) setQueryData<Me>("me", (me) => me && { ...me, preferences: saved });
  };
}

export function AppearanceSettings() {
  const t = useT();
  const app = useApp();
  const save = useSavePreferences();
  const syncIndicatorHidden = useSyncIndicatorHidden();
  return (
    <SettingsGroup id="aparencia" title={t("Aparência")}>
      <div className="set-card">
        <SettingsRow icon={<IconMonitor />} label={t("Idioma")} labelFor="language" hint={t("Idioma da interface neste espaço.")}
          control={<LanguagePicker id="language" value={app.me.preferences.locale ?? defaultLocale}
            onChange={(locale) => save({ locale })} />} />
        <SettingsRow icon={<IconMonitor />} label={t("Tema")} hint={t("Claro, escuro ou igual ao sistema.")} control={
          <div className="seg compact" role="radiogroup" aria-label={t("Tema")}>
            {THEMES.map((theme) => (
              <button key={theme.value} type="button" role="radio" aria-checked={app.me.preferences.theme === theme.value}
                className={`seg-o${app.me.preferences.theme === theme.value ? " on" : ""}`}
                onClick={() => void save({ theme: theme.value })}>
                {theme.icon}{t(theme.label)}
              </button>
            ))}
          </div>
        } />
        <SettingsRow icon={<IconRepeat />} label={t("Mostrar indicador de sincronização")} labelFor="sync-indicator"
          hint={t("Exibe a bolinha com o estado da sincronização neste dispositivo.")}
          control={
            <button id="sync-indicator" type="button" role="switch" aria-checked={!syncIndicatorHidden}
              aria-label={t("Mostrar indicador de sincronização")} className={`switch${syncIndicatorHidden ? "" : " on"}`}
              onClick={() => setSyncIndicatorHidden(!syncIndicatorHidden)} />
          } />
      </div>
    </SettingsGroup>
  );
}

export function AgendaSettings() {
  const t = useT();
  const app = useApp();
  const save = useSavePreferences();
  return (
    <SettingsGroup id="agenda" title="Agenda">
      <div className="set-card">
        <SettingsRow icon={<IconClock />} label={t("Fuso horário do perfil")} labelFor="tz"
          hint={t("Define o que é “Hoje” e quando uma tarefa fica atrasada.")}
          control={<TimezonePicker id="tz" value={app.timezone} onChange={(timezone) => void save({ timezone })} />} />
      </div>
    </SettingsGroup>
  );
}

export function ArchivedSettings() {
  const t = useT();
  const app = useApp();
  const archived = useQuery<{ projects: ProjectSummary[] }>("archived", () => api.projects.list("archived"));
  return (
    <SettingsGroup id="arquivados" title={t("Projetos arquivados")}>
      <div className="set-card">
        {!archived.data && <div className="set-row"><ReadFallback error={archived.error} loading={archived.loading} onRetry={archived.reload} /></div>}
        {archived.data?.projects.length === 0 && <div className="set-row"><span className="hint">{t("Nenhum projeto arquivado.")}</span></div>}
        {archived.data?.projects.map((project) => (
          <SettingsRow key={project.id} icon={<IconHash />} label={<Link href={`/projetos/${project.id}`}>{project.name}</Link>} control={
            <button type="button" className="btn" onClick={() => void app.run(() => api.projects.unarchive(project.id, project.revision), {
              success: t("“{0}” reativado", [project.name]), revalidate: refreshProjects,
            })}>{t("Reativar")}</button>
          } />
        ))}
      </div>
    </SettingsGroup>
  );
}

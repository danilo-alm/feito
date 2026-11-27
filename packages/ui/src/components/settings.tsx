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
import type { DarkTheme, LightTheme, Me, ProjectSummary, Preferences } from "@feito/core/types";
import { chosenAccent, chosenDark, chosenLight, darkThemes, isLightTheme, lightThemes, themeName, type ThemeName } from "../client/themes";
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

/** Miniatura do tema, pintada com os próprios tokens dele (data-theme no elemento). */
function ThemeCard({ theme, checked, onPick }: { theme: ThemeName; checked: boolean; onPick: () => void }) {
  const t = useT();
  return (
    <button type="button" role="radio" aria-checked={checked} className={`theme-card${checked ? " on" : ""}`} onClick={onPick}>
      <span className="theme-preview" data-theme={theme} aria-hidden="true">
        <span className="tp-side"><i className="tp-accent" /><i /><i /></span>
        <span className="tp-main">
          <i className="tp-title" />
          <span className="tp-row"><b style={{ borderColor: "var(--proj-violeta)" }} /><i /></span>
          <span className="tp-row"><b style={{ borderColor: "var(--proj-ambar)" }} /><i /></span>
          <span className="tp-row"><b style={{ borderColor: "var(--proj-turquesa)" }} /><i /></span>
        </span>
      </span>
      <span className="theme-name">{themeName(theme, t)}</span>
    </button>
  );
}

function ThemeGrid({ label, themes, value, onPick }: {
  label: string; themes: readonly ThemeName[]; value: ThemeName; onPick: (theme: ThemeName) => void;
}) {
  return (
    <div className="theme-grid" role="radiogroup" aria-label={label}>
      {themes.map((theme) => <ThemeCard key={theme} theme={theme} checked={theme === value} onPick={() => onPick(theme)} />)}
    </div>
  );
}

/** Tema: segue o sistema com um tema claro e um escuro, ou fica fixo em um tema. */
function ThemeSettings() {
  const t = useT();
  const app = useApp();
  const save = useSavePreferences();
  const preferences = app.me.preferences;
  const follow = preferences.theme === "system";
  const light = chosenLight(preferences);
  const dark = chosenDark(preferences);
  const accent = chosenAccent(preferences);
  const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const current = preferences.theme === "dark" ? dark : light;
  const pickFixed = (theme: ThemeName) => void save(isLightTheme(theme) ? { theme: "light", lightTheme: theme } : { theme: "dark", darkTheme: theme });
  return (
    <>
      <SettingsRow icon={<IconMonitor />} label={t("Seguir o sistema")} labelFor="theme-follow"
        hint={t("Usa um tema quando o sistema estiver claro e outro quando estiver escuro.")}
        control={<button id="theme-follow" type="button" role="switch" aria-checked={follow} className={`switch${follow ? " on" : ""}`}
          onClick={() => void save({ theme: follow ? (systemDark() ? "dark" : "light") : "system" })} />}
        extra={follow ? (
          <div className="theme-groups">
            <div className="theme-group-h"><IconSun />{t("Quando o sistema estiver claro")}</div>
            <ThemeGrid label={t("Quando o sistema estiver claro")} themes={lightThemes} value={light} onPick={(theme) => void save({ lightTheme: theme as LightTheme })} />
            <div className="theme-group-h"><IconMoon />{t("Quando o sistema estiver escuro")}</div>
            <ThemeGrid label={t("Quando o sistema estiver escuro")} themes={darkThemes} value={dark} onPick={(theme) => void save({ darkTheme: theme as DarkTheme })} />
          </div>
        ) : (
          <div className="theme-groups">
            <ThemeGrid label={t("Tema")} themes={[...lightThemes, ...darkThemes]} value={current} onPick={pickFixed} />
          </div>
        )} />
      <SettingsRow icon={<IconMonitor />} label={t("Cor de destaque")}
        hint={t("Botões, item ativo e foco nos temas do Feito. Os temas de editor usam a cor deles.")}
        control={
          <div className="seg compact" role="radiogroup" aria-label={t("Cor de destaque")}>
            {(["green", "violet"] as const).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={accent === value} className={`seg-o${accent === value ? " on" : ""}`}
                onClick={() => void save({ accent: value })}>
                <span className={`accent-dot accent-${value}`} aria-hidden="true" />{t(value === "green" ? "Verde" : "Violeta")}
              </button>
            ))}
          </div>
        } />
    </>
  );
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
        <ThemeSettings />
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

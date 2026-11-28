"use client";
import { defaultLocale } from "@feito/core/domain/preferences";
import { useT } from "./language";
import { loadLocale } from "../client/locale";

import { LanguagePicker } from "./language-picker";
import { Link } from "../navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { api } from "../client/api";
import { cacheScope, setQueryData, useQuery } from "../client/store";
import { setSyncIndicatorHidden, useSyncIndicatorHidden } from "../client/sync-indicator";
import { ACCENTS, isHexAccent, type Accent, type DarkTheme, type HexAccent, type LightTheme, type Me, type PresetAccent, type ProjectSummary, type Preferences } from "@feito/core/types";
import { chosenAccent, chosenDark, chosenLight, darkThemes, isFeitoTheme, isLightTheme, lightThemes, systemColorScheme, themeName, type ThemeName } from "../client/themes";
import { refreshProjects, useApp } from "./app";
import { AccentColorEditor } from "./accent-color-editor";
import {
  IconCheck, IconChevronDown, IconChevronRight, IconClock, IconHash, IconLock, IconMonitor, IconMoon, IconPlus, IconRepeat, IconSun,
} from "./icons";
import { PickerGrid } from "./project-style";
import { TimezonePicker } from "./timezone-picker";
import { Dialog, Popover, ReadFallback } from "./ui";

// Ajustes em grupos de linhas: ícone, nome e explicação à esquerda, controle à direita.
// O web e o desktop montam a página com os mesmos grupos; o desktop acrescenta os espaços de trabalho.

export type SettingsTab = { id: string; label: string; content: ReactNode };
const TAB_KEY = "feito:settings-tab";

/** Ajustes em abas: uma seção por vez, e a última aberta volta na próxima visita. Setas trocam de aba. */
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const t = useT();
  const [current, setCurrent] = useState(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved && tabs.some((tab) => tab.id === saved)) return saved;
    } catch {
      // Sem armazenamento, abre na primeira aba.
    }
    return tabs[0].id;
  });
  const list = useRef<HTMLDivElement>(null);
  const pick = (id: string) => {
    setCurrent(id);
    try { localStorage.setItem(TAB_KEY, id); } catch { /* Só lembra durante a visita. */ }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === current);
    const next = Number.isFinite(step) ? (index + step + tabs.length) % tabs.length : step < 0 ? 0 : tabs.length - 1;
    pick(tabs[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  const active = tabs.find((tab) => tab.id === current) ?? tabs[0];
  return (
    <>
      <div ref={list} className="set-tabs" role="tablist" aria-label={t("Seções dos ajustes")} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" id={`set-tab-${tab.id}`} aria-selected={tab.id === active.id}
            aria-controls={`set-panel-${tab.id}`} tabIndex={tab.id === active.id ? 0 : -1}
            className={`set-tab${tab.id === active.id ? " on" : ""}`} onClick={() => pick(tab.id)}>{tab.label}</button>
        ))}
      </div>
      <div className="set-panel" role="tabpanel" id={`set-panel-${active.id}`} aria-labelledby={`set-tab-${active.id}`}>
        {active.content}
      </div>
    </>
  );
}

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

const accentNames: Record<PresetAccent, string> = {
  green: "Verde",
  teal: "Verde-azulado",
  mint: "Verde menta",
  lime: "Verde limão",
  cyan: "Ciano",
  sky: "Azul céu",
  blue: "Azul",
  indigo: "Índigo",
  violet: "Violeta",
  lavender: "Lavanda",
  purple: "Roxo",
  magenta: "Magenta",
  pink: "Rosa",
  red: "Vermelho",
  coral: "Coral",
  orange: "Laranja",
  terracotta: "Terracota",
  amber: "Âmbar",
  yellow: "Amarelo",
  graphite: "Grafite",
};
const accentOptions = [
  ...ACCENTS.filter((value) => value !== "graphite").map((value) => ({ value, label: accentNames[value] })),
  { value: "custom" as const, label: "Cor personalizada" },
];

function AccentPicker({ theme, value, onPick }: { theme: ThemeName; value: Accent; onPick: (accent: Accent) => void }) {
  const t = useT();
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState<HexAccent | null>(null);
  const enabled = isFeitoTheme(theme);
  const custom = isHexAccent(value);
  const selected = custom ? "custom" : value;
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      setCustomStart(null);
    }
  }, [enabled]);

  const pick = (accent: Accent) => {
    setOpen(false);
    anchor?.focus();
    if (accent !== value) onPick(accent);
  };
  const openCustom = () => {
    const current = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    setOpen(false);
    anchor?.focus();
    setCustomStart(custom ? value : isHexAccent(current) ? current : "#0b7a54");
  };
  return (
    <SettingsRow icon={<IconMonitor />} label={<span id={id}>{t("Cor de destaque")}</span>}
      hint={<span id={`${id}-hint`}>{enabled
        ? t("Personaliza botões, itens ativos e indicadores de foco.")
        : t("O tema atual usa uma cor de destaque própria.")}</span>}
      control={
        <>
          <button ref={setAnchor} type="button" className="select accent-trigger" disabled={!enabled}
            aria-labelledby={enabled ? `${id} ${id}-value` : id} aria-describedby={`${id}-hint`}
            aria-haspopup="dialog" aria-expanded={enabled && open} onClick={() => setOpen(!open)}>
            <span className="accent-swatch" data-theme={theme} data-accent={enabled && !custom ? value : undefined}
              style={enabled && custom ? { backgroundColor: value } : undefined} aria-hidden="true" />
            {enabled ? <><span id={`${id}-value`}>{custom ? value.toUpperCase() : t(accentNames[value])}</span><IconChevronDown /></> : <IconLock />}
          </button>
          <Popover anchor={anchor} open={enabled && open} onClose={() => setOpen(false)}
            label={t("Cor de destaque")} align="end" width={264}>
            <PickerGrid className="accent-picker" label={t("Cor de destaque")} options={accentOptions} selected={selected}
              onSelect={(accent) => accent === "custom" ? openCustom() : pick(accent)} autoFocus showTooltips={false}>
              {(accent) => (
                accent === "custom"
                  ? <span className="accent-custom-option" aria-hidden="true">{custom ? <IconCheck /> : <IconPlus />}</span>
                  : <span className="accent-swatch" data-theme={theme} data-accent={accent} aria-hidden="true">
                    {accent === value && <IconCheck />}
                  </span>
              )}
            </PickerGrid>
          </Popover>
          <Dialog open={enabled && customStart !== null} onClose={() => setCustomStart(null)} title={t("Cor personalizada")} width={360}>
            {customStart !== null && <AccentColorEditor initial={customStart} onClose={() => setCustomStart(null)}
              onSave={(accent) => {
                setCustomStart(null);
                if (accent !== value) onPick(accent);
              }} />}
          </Dialog>
        </>
      } />
  );
}

function subscribeSystemColorScheme(onChange: () => void) {
  const media = systemColorScheme();
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
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
  const systemDark = useSyncExternalStore(subscribeSystemColorScheme, () => systemColorScheme().matches, () => false);
  const current = (follow ? systemDark : preferences.theme === "dark") ? dark : light;
  const pickFixed = (theme: ThemeName) => void save(isLightTheme(theme) ? { theme: "light", lightTheme: theme } : { theme: "dark", darkTheme: theme });
  return (
    <>
      <SettingsRow icon={<IconMonitor />} label={t("Seguir o sistema")} labelFor="theme-follow"
        hint={t("Usa um tema quando o sistema estiver claro e outro quando estiver escuro.")}
        control={<button id="theme-follow" type="button" role="switch" aria-checked={follow} className={`switch${follow ? " on" : ""}`}
          onClick={() => void save({ theme: follow ? (systemDark ? "dark" : "light") : "system" })} />}
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
      <AccentPicker theme={current} value={chosenAccent(preferences)} onPick={(accent) => void save({ accent })} />
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

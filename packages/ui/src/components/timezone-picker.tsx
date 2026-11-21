"use client";
import { getLocale, translate as t } from "../client/locale";
import { useT } from "./language";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconMonitor, IconSearch } from "./icons";
import { Dialog, Popover, useIsMobile } from "./ui";

type Zone = {
  id: string;
  city: string;
  region: string;
  name: string;
  offset: number;
  offsetLabel: string;
  haystack: string;
};

const REGIONS: Record<string, string> = {
  Africa: "África", America: "América", Antarctica: "Antártida", Arctic: "Ártico", Asia: "Ásia",
  Atlantic: "Atlântico", Australia: "Austrália", Europe: "Europa", Indian: "Índico", Pacific: "Pacífico",
  Etc: "Genérico",
};

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const zoneKey = (id: string) => id === "Asia/Calcutta" ? "Asia/Kolkata" : id;
const byOffsetAndCity = (a: Zone, b: Zone) => a.offset - b.offset || a.city.localeCompare(b.city, getLocale());

function offsetMinutes(id: string, now: Date) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: "longOffset" })
      .formatToParts(now).find((item) => item.type === "timeZoneName")?.value ?? "GMT";
    const match = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(part);
    if (!match) return 0;
    return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  } catch {
    return 0;
  }
}

function genericName(id: string, now: Date) {
  for (const style of ["longGeneric", "long"] as const) {
    try {
      const value = new Intl.DateTimeFormat(getLocale(), { timeZone: id, timeZoneName: style })
        .formatToParts(now).find((item) => item.type === "timeZoneName")?.value;
      if (value && !/^GMT/.test(value)) return value;
    } catch {
      // estilo não suportado neste navegador
    }
  }
  return "";
}

function formatOffset(minutes: number) {
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const rest = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/** Variações que alguém digita para um deslocamento: "-3", "gmt-3", "utc-03:00", "+5:30"… */
function offsetTerms(minutes: number) {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = String(abs % 60).padStart(2, "0");
  const short = abs % 60 ? `${hours}:${rest}` : `${hours}`;
  const long = `${String(hours).padStart(2, "0")}:${rest}`;
  const bases = [`${sign}${short}`, `${sign}${long}`, `${sign}${long.replace(":", "")}`];
  return [...bases, ...bases.flatMap((base) => [`gmt${base}`, `utc${base}`])].join(" ");
}

function describe(id: string, now: Date): Zone {
  const key = zoneKey(id);
  const parts = key.split("/");
  const city = parts[parts.length - 1].replace(/_/g, " ");
  const region = parts.length > 1 ? [t(REGIONS[parts[0]] ?? parts[0]), ...parts.slice(1, -1).map((p) => p.replace(/_/g, " "))].join(" · ") : "";
  const name = genericName(id, now);
  const offset = offsetMinutes(id, now);
  return {
    id, city, region, name, offset,
    offsetLabel: formatOffset(offset),
    haystack: fold([
      id, id.replace(/[_/]/g, " "), city, region, name, offsetTerms(offset), offset === 0 ? "utc gmt" : "",
      key === "Asia/Kolkata" ? "Asia/Kolkata Asia/Calcutta Calcutta" : "",
    ].join(" ")),
  };
}

let cache: Zone[] | null = null;
let cacheLocale = getLocale();
function allZones(extra: string) {
  if (!cache || cacheLocale !== getLocale()) {
    cacheLocale = getLocale();
    let ids: string[];
    try {
      ids = Intl.supportedValuesOf("timeZone");
    } catch {
      ids = [];
    }
    if (!ids.includes("UTC")) ids = [...ids, "UTC"];
    const now = new Date();
    const distinct = new Map(ids.map((id) => [zoneKey(id), id]));
    cache = [...distinct.values()].map((id) => describe(id, now)).sort(byOffsetAndCity);
  }
  return extra && !cache.some((zone) => zoneKey(zone.id) === zoneKey(extra))
    ? [...cache, describe(extra, new Date())].sort(byOffsetAndCity)
    : cache;
}

function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

export function TimezonePicker({ id, value, onChange }: { id?: string; value: string; onChange: (zone: string) => void }) {
  const t = useT();
  const mobile = useIsMobile();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const current = useMemo(() => describe(value, new Date()), [value, t]);

  const pick = (zone: string) => {
    setOpen(false);
    anchor?.focus();
    if (zoneKey(zone) !== zoneKey(value)) onChange(zone);
  };

  const panel = open && <ZoneSearch value={value} onPick={pick} mobile={mobile} />;

  return (
    <>
      <button ref={setAnchor} id={id} type="button" className="select tz-trigger" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((state) => !state)} onPointerDown={(event) => event.stopPropagation()}>
        <span className="tz-trigger-text">
          <span className="tz-city">{current.city}</span>
          <span className="tz-offset">{current.offsetLabel}</span>
        </span>
        <IconChevronDown />
      </button>
      {mobile ? (
        <Dialog open={open} onClose={close} title={t("Fuso horário")}>{panel}</Dialog>
      ) : (
        <Popover anchor={anchor} open={open} onClose={close} label={t("Escolher fuso horário")} align="end" width={380}>
          {panel}
        </Popover>
      )}
    </>
  );
}

function ZoneSearch({ value, onPick, mobile }: { value: string; onPick: (zone: string) => void; mobile: boolean }) {
  const t = useT();
  const listId = useId();
  const zones = useMemo(() => allZones(value), [value, t]);
  const device = useMemo(deviceZone, []);
  const deviceInfo = zones.find((zone) => zoneKey(zone.id) === zoneKey(device));
  const selected = (zone: Zone) => zoneKey(zone.id) === zoneKey(value);
  const [query, setQuery] = useState("");
  const tokens = useMemo(() => fold(query).split(/\s+/).filter(Boolean), [query]);
  const visible = useMemo(
    () => (tokens.length ? zones.filter((zone) => tokens.every((token) => zone.haystack.includes(token))) : zones),
    [zones, tokens],
  );
  const [active, setActive] = useState(() => Math.max(0, zones.findIndex(selected)));
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMode = useRef<ScrollLogicalPosition>("center");

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: scrollMode.current });
    scrollMode.current = "nearest";
  }, [active, visible]);

  const onQuery = (text: string) => {
    setQuery(text);
    setActive(0);
  };

  const onKey = (event: React.KeyboardEvent) => {
    const last = visible.length - 1;
    const move: Record<string, number> = {
      ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1),
      PageDown: Math.min(last, active + 8), PageUp: Math.max(0, active - 8),
    };
    if (event.key in move) {
      event.preventDefault();
      setActive(move[event.key]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (visible[active]) onPick(visible[active].id);
    }
  };

  const optionId = (index: number) => `${listId}-o${index}`;

  return (
    <div className={`tz-panel${mobile ? " mobile" : ""}`}>
      <div className="tz-search">
        <IconSearch />
        <input data-autofocus className="tz-input" placeholder={t("Buscar cidade, país ou UTC−3")} value={query}
          role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label={t("Buscar fuso horário")}
          aria-activedescendant={visible[active] ? optionId(active) : undefined}
          autoComplete="off" spellCheck={false}
          onChange={(event) => onQuery(event.target.value)} onKeyDown={onKey} />
      </div>
      {deviceInfo && !selected(deviceInfo) && !tokens.length && (
        <button type="button" className="mi tz-device" onClick={() => onPick(device)}>
          <IconMonitor />
          <span className="tz-label">
            <span>{t("Usar o deste dispositivo")}</span>
            <span className="tz-meta">{deviceInfo.city} · {deviceInfo.offsetLabel}</span>
          </span>
        </button>
      )}
      <div ref={listRef} id={listId} className="tz-list" role="listbox" aria-label={t("Fusos horários")}>
        {visible.map((zone, index) => (
          <div key={zone.id} id={optionId(index)} data-index={index} role="option" aria-selected={selected(zone)}
            className={`mi tz-option${index === active ? " hl" : ""}`}
            onPointerMove={() => { if (index !== active) { scrollMode.current = "nearest"; setActive(index); } }}
            onClick={() => onPick(zone.id)}>
            <span className="tz-check">{selected(zone) && <IconCheck />}</span>
            <span className="tz-label">
              <span className="tz-city">{zone.city}</span>
              <span className="tz-meta">{[zone.region, zone.name].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="tz-offset">{zone.offsetLabel}</span>
          </div>
        ))}
        {!visible.length && <p className="hint tz-empty">{t("Nenhum fuso encontrado para “")}{query.trim()}”.</p>}
      </div>
    </div>
  );
}

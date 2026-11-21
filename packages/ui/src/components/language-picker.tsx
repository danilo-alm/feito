"use client";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import type { Locale } from "@feito/core/types";
import { languages } from "../client/locale";
import { IconCheck, IconChevronDown } from "./icons";
import { useT } from "./language";
import { Dialog, Popover, useIsMobile } from "./ui";

export function LanguagePicker({ id, value, onChange }: {
  id: string; value: Locale; onChange: (locale: Locale) => Promise<void>;
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const mobile = useIsMobile();
  const close = useCallback(() => setOpen(false), []);
  const select = async (locale: Locale) => {
    close();
    anchor.current?.focus();
    if (locale === value) return;
    setSaving(true);
    try { await onChange(locale); } finally { setSaving(false); }
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  };
  const choices = <div className="menu" role="listbox" aria-label={t("Idioma")} onKeyDown={onKey}>
    {languages.map((language) => <button key={language.value} type="button" role="option"
      aria-selected={value === language.value} data-autofocus={value === language.value || undefined}
      className="mi" lang={language.value} onClick={() => void select(language.value)}>
      <span style={{ flex: 1 }}>{language.label}</span>{value === language.value && <IconCheck />}
    </button>)}
  </div>;
  return <>
    <button id={id} ref={anchor} type="button" className="select" aria-disabled={saving} aria-busy={saving}
      aria-haspopup={mobile ? "dialog" : "listbox"} aria-expanded={open}
      onClick={() => { if (!saving) setOpen((current) => !current); }}>
      {languages.find((language) => language.value === value)?.label}<IconChevronDown />
    </button>
    {mobile ? <Dialog open={open} onClose={close} title={t("Idioma")}>{choices}</Dialog>
      : <Popover anchor={anchor.current} open={open} onClose={close} label={t("Idioma")} align="end" width={240}>
        {choices}
      </Popover>}
  </>;
}

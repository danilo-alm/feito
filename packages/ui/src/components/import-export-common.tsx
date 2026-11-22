"use client";

import { translate as t } from "../client/locale";
import { useT } from "./language";
import { IconX } from "./icons";
import s from "./import-export.module.css";

export type ImportTarget = { id: string; name: string };
export type ExportTarget = ImportTarget & { activeCount?: number };

export const plural = (count: number, one: string, many: string) => `${count} ${t(count === 1 ? one : many)}`;

export function Monogram({ name, small }: { name: string; small?: boolean }) {
  return <span className={`${s.monogram}${small ? ` ${s.small}` : ""}`} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>;
}

/** O cabeçalho permanece disponível enquanto o formulário carrega. */
export function DialogHead({ eyebrow, title, id, onClose }: { eyebrow: string; title: string; id: string; onClose: () => void }) {
  const t = useT();
  return <div className={s.dialogHead}>
    <div>
      <span className={s.label}>{eyebrow}</span>
      <h2 id={id}>{title}</h2>
    </div>
    <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Fechar (Esc)")}><IconX /></button>
  </div>;
}

"use client";

import { useT } from "./language";

import { useState } from "react";
import { api, errorMessage } from "../client/api";
import { exportFormats, type ExportFormat } from "@feito/core/domain/export-formats";
import { IconCheck, IconDownload } from "./icons";
import { Monogram, plural, type ExportTarget as Target } from "./import-export-common";
export { useExportDialog } from "./import-export-dialogs";
import { useToast } from "./ui";
import s from "./import-export.module.css";

const defaults = (format: ExportFormat) => Object.fromEntries(format.options.map((option) => [option.id, option.default]));
// Mesma limpeza do nome que o servidor faz no Content-Disposition.
const fileName = (name: string, format: ExportFormat) => `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")}.${format.extension}`;

export function ExportForm({ target, onDone }: { target: Target; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [formatId, setFormatId] = useState<ExportFormat["id"]>(exportFormats[0].id);
  const format = exportFormats.find((item) => item.id === formatId)!;
  const [options, setOptions] = useState<Record<string, boolean>>(defaults(format));

  const pick = (next: ExportFormat) => {
    setFormatId(next.id);
    setOptions(defaults(next));
  };

  return (
    <div className={s.dialogBody}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend className={s.label} style={{ padding: 0, marginBottom: 8 }}>{t("Modelo do arquivo")}</legend>
        <div className={s.choices} role="radiogroup" aria-label={t("Modelo do arquivo")}>
          {exportFormats.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={item.id === formatId}
              className={`${s.choice} ${s.wide}`} onClick={() => pick(item)}>
              <Monogram name={item.name} />
              <span className={s.choiceText}>
                <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className={s.choiceName}>{item.name}</span>
                  <span className={s.sub} style={{ fontSize: 12 }}>{t(item.fileKind)}</span>
                </span>
                <span className={s.sub} style={{ fontSize: 12.5 }}>{t(item.description)}</span>
              </span>
              <span className={s.tick} aria-hidden="true"><IconCheck /></span>
            </button>
          ))}
        </div>
      </fieldset>

      {format.options.map((option) => (
        <div key={option.id} className={s.option}>
          <div>
            <span id={`export-${option.id}`} style={{ fontWeight: 600 }}>{t(option.label)}</span>
            <span className={s.sub} style={{ fontSize: 12.5 }}>{t(option.hint)}</span>
          </div>
          <button type="button" className={`switch${options[option.id] ? " on" : ""}`} role="switch"
            aria-checked={options[option.id]} aria-labelledby={`export-${option.id}`}
            onClick={() => setOptions((current) => ({ ...current, [option.id]: !current[option.id] }))} />
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className={s.label}>{t("O que vai no arquivo")}</span>
        <div className={s.chips}>
          <span className={`${s.chip} ${s.on}`}>
            {target.activeCount === undefined ? t("Tarefas abertas") : plural(target.activeCount, t("tarefa aberta"), t("tarefas abertas"))}
          </span>
          <span className={`${s.chip} ${s.on}`}>{t("Seções e subtarefas")}</span>
          <span className={`${s.chip} ${s.on}`}>{t("Etiquetas e recorrências")}</span>
          <span className={`${s.chip} ${s.off}`}><span className="sr-only">{t("Não inclui:")}{" "}</span>{t("Concluídas")}</span>
        </div>
      </div>

      {failure && <p className="field-error" role="alert">{failure}</p>}
      <div className={`${s.actions} ${s.dialogFoot}`}>
        <span className={s.hint}>{fileName(target.name, format)}</span>
        <button type="button" className="btn" onClick={onDone}>{t("Cancelar")}</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => {
          setBusy(true);
          setFailure(undefined);
          void api.portability.downloadProject(target.id, format.id, options, fileName(target.name, format)).then(() => {
            toast(t("Exportação iniciada"));
            onDone();
          }, (error: unknown) => setFailure(errorMessage(error))).finally(() => setBusy(false));
        }}>
          <IconDownload />{t("Baixar")}{" "}{format.extension.toUpperCase()}
        </button>
      </div>
    </div>
  );
}

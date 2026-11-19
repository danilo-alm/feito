"use client";
import { useState, type ReactNode } from "react";
import { api } from "@/client/api";
import { exportFormats, type ExportFormat } from "@/domain/export-formats";
import { IconCheck, IconDownload } from "@/components/icons";
import { DialogHead, Monogram, plural } from "@/components/import-panel";
import { Dialog, useToast } from "@/components/ui";
import s from "./import-export.module.css";

type Target = { id: string; name: string; activeCount?: number };

const defaults = (format: ExportFormat) => Object.fromEntries(format.options.map((option) => [option.id, option.default]));
// Mesma limpeza do nome que o servidor faz no Content-Disposition.
const fileName = (name: string, format: ExportFormat) => `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")}.${format.extension}`;

function ExportForm({ target, onDone }: { target: Target; onDone: () => void }) {
  const toast = useToast();
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
        <legend className={s.label} style={{ padding: 0, marginBottom: 8 }}>Modelo do arquivo</legend>
        <div className={s.choices} role="radiogroup" aria-label="Modelo do arquivo">
          {exportFormats.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={item.id === formatId}
              className={`${s.choice} ${s.wide}`} onClick={() => pick(item)}>
              <Monogram name={item.name} />
              <span className={s.choiceText}>
                <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className={s.choiceName}>{item.name}</span>
                  <span className={s.sub} style={{ fontSize: 12 }}>{item.fileKind}</span>
                </span>
                <span className={s.sub} style={{ fontSize: 12.5 }}>{item.description}</span>
              </span>
              <span className={s.tick} aria-hidden="true"><IconCheck /></span>
            </button>
          ))}
        </div>
      </fieldset>

      {format.options.map((option) => (
        <div key={option.id} className={s.option}>
          <div>
            <span id={`export-${option.id}`} style={{ fontWeight: 600 }}>{option.label}</span>
            <span className={s.sub} style={{ fontSize: 12.5 }}>{option.hint}</span>
          </div>
          <button type="button" className={`switch${options[option.id] ? " on" : ""}`} role="switch"
            aria-checked={options[option.id]} aria-labelledby={`export-${option.id}`}
            onClick={() => setOptions((current) => ({ ...current, [option.id]: !current[option.id] }))} />
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className={s.label}>O que vai no arquivo</span>
        <div className={s.chips}>
          <span className={`${s.chip} ${s.on}`}>
            {target.activeCount === undefined ? "Tarefas abertas" : plural(target.activeCount, "tarefa aberta", "tarefas abertas")}
          </span>
          <span className={`${s.chip} ${s.on}`}>Seções e subtarefas</span>
          <span className={`${s.chip} ${s.on}`}>Etiquetas e recorrências</span>
          <span className={`${s.chip} ${s.off}`}><span className="sr-only">Não inclui: </span>Concluídas</span>
        </div>
      </div>

      <div className={`${s.actions} ${s.dialogFoot}`}>
        <span className={s.hint}>{fileName(target.name, format)}</span>
        <button type="button" className="btn" onClick={onDone}>Cancelar</button>
        <a className="btn primary" href={api.portability.projectExportUrl(target.id, format.id, options)} download
          onClick={() => { toast("Exportação iniciada"); onDone(); }}>
          <IconDownload />Baixar {format.extension.toUpperCase()}
        </a>
      </div>
    </div>
  );
}

/** Diálogo para exportar um projeto num modelo de `exportFormats`. Devolve o elemento e a função que o abre. */
export function useExportDialog(): [ReactNode, (target: Target) => void] {
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const close = () => setOpen(false);
  const element = (
    <Dialog open={open} onClose={close} title={target ? `Exportar ${target.name}` : "Exportar"} labelledBy="export-dialog-h" hideHeader width={540}>
      {target && (
        <>
          <DialogHead eyebrow="Exportar" title={target.name} id="export-dialog-h" onClose={close} />
          <ExportForm key={`${target.id}:${session}`} target={target} onDone={close} />
        </>
      )}
    </Dialog>
  );
  return [element, (next) => { setSession((value) => value + 1); setTarget(next); setOpen(true); }];
}

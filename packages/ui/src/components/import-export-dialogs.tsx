"use client";

import { useState, type ReactNode } from "react";
import { importSources } from "@feito/core/domain/import-sources";
import { useT } from "./language";
import { lazyScreen } from "./lazy-screen";
import { Dialog } from "./ui";
import { DialogHead, type ImportTarget, type ExportTarget } from "./import-export-common";
import s from "./import-export.module.css";

const ImportFlow = lazyScreen(async () => ({ default: (await import("./import-panel")).ImportFlow }));
const ExportForm = lazyScreen(async () => ({ default: (await import("./export-dialog")).ExportForm }));

/** Mantém o modal e o foco disponíveis sem carregar o fluxo antes de abrir. */
export function useImportDialog(): [ReactNode, (target?: ImportTarget) => void] {
  const t = useT();
  const [target, setTarget] = useState<ImportTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const close = () => setOpen(false);
  const sourceNames = importSources.map((item) => item.name).join(", ");
  const element = (
    <Dialog open={open} onClose={close} title={target ? t("Importar para {0}", [target.name]) : t("Importar do {0}", [sourceNames])}
      labelledBy="import-dialog-h" hideHeader width={600}>
      {session > 0 && <>
        <DialogHead eyebrow={target ? t("Importar para") : t("Importar de outro app")} title={target?.name ?? sourceNames}
          id="import-dialog-h" onClose={close} />
        <div className={s.dialogBody}>
          <ImportFlow key={`${target?.id ?? "novo"}:${session}`} variant="dialog" target={target ?? undefined} onClose={close} />
        </div>
      </>}
    </Dialog>
  );
  return [element, (next) => { setSession((value) => value + 1); setTarget(next ?? null); setOpen(true); }];
}

export function useExportDialog(): [ReactNode, (target: ExportTarget) => void] {
  const t = useT();
  const [target, setTarget] = useState<ExportTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const close = () => setOpen(false);
  const element = (
    <Dialog open={open} onClose={close} title={target ? t("Exportar {0}", [target.name]) : t("Exportar")} labelledBy="export-dialog-h" hideHeader width={540}>
      {target && <>
        <DialogHead eyebrow={t("Exportar")} title={target.name} id="export-dialog-h" onClose={close} />
        <ExportForm key={`${target.id}:${session}`} target={target} onDone={close} />
      </>}
    </Dialog>
  );
  return [element, (next) => { setSession((value) => value + 1); setTarget(next); setOpen(true); }];
}

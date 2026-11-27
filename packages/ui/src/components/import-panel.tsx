"use client";

import { translateMessage, translate as t } from "../client/locale";
import { useT } from "./language";

import { Link } from "../navigation";
import { useState, type DragEvent } from "react";
import { api, ApiFailure, errorMessage } from "../client/api";
import type { SourceImportPreview, SourceImportResult } from "@feito/core/types";
import { useApp } from "./app";
import {
  IconAlert, IconCheck, IconChevronDown, IconChevronRight, IconFileUp, IconHash, IconLock, IconPlus, IconUpload,
} from "./icons";
import { Collapse } from "./motion";
import { useToast } from "./ui";
import { LAYOUT_LABEL } from "./view-menu";
import { Monogram, plural, type ImportTarget as Target } from "./import-export-common";
export { DialogHead, Monogram, plural } from "./import-export-common";
export { useImportDialog } from "./import-export-dialogs";
import { importSources, type ImportSource } from "@feito/core/domain/import-sources";
import s from "./import-export.module.css";

type Variant = "panel" | "dialog";

function SourceChoices({ selected, onSelect }: { selected: ImportSource["id"]; onSelect: (id: ImportSource["id"]) => void }) {
  const t = useT();
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className={s.label} style={{ padding: 0, marginBottom: 8 }}>{t("De onde vêm os dados")}</legend>
      <div className={s.choices} role="radiogroup" aria-label={t("De onde vêm os dados")}>
        {importSources.map((item) => (
          <button key={item.id} type="button" role="radio" aria-checked={item.id === selected} className={s.choice}
            onClick={() => onSelect(item.id)}>
            <Monogram name={item.name} />
            <span className={s.choiceText}>
              <span className={s.choiceName}>{item.name}</span>
              <span className={s.sub} style={{ fontSize: 12 }}>{t(item.fileKind)}</span>
            </span>
            <span className={s.tick} aria-hidden="true"><IconCheck /></span>
          </button>
        ))}
        <div className={s.soon}>
          <span className={s.soonIcon} aria-hidden="true"><IconPlus /></span>
          {t("Outros apps chegam em breve")}</div>
      </div>
    </fieldset>
  );
}

function Steps({ source }: { source: ImportSource }) {
  const t = useT();
  return (
    <ol className={s.steps} aria-label={t("Como importar")}>
      {source.steps.map((step, index) => (
        <li key={t(step.title)} className={s.step}>
          <span className={s.stepN} aria-hidden="true">{index + 1}</span>
          <span className={s.stepTitle}>{t(step.title)}</span>
          <span className={s.stepBody}>{t(step.body)}</span>
        </li>
      ))}
    </ol>
  );
}

function matches(file: File, accept: string) {
  return accept.split(",").some((rule) => {
    const value = rule.trim().toLowerCase();
    return value.startsWith(".") ? file.name.toLowerCase().endsWith(value) : file.type === value;
  });
}

/** Área de soltar. É o <label> do seletor de arquivos: clique, toque, teclado e leitor de tela funcionam. */
function DropZone({ source, busy, onFiles }: { source: ImportSource; busy: boolean; onFiles: (files: File[]) => void }) {
  const t = useT();
  const [over, setOver] = useState(false);
  const id = `import-${source.id}`;
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    if (!busy) onFiles([...event.dataTransfer.files].filter((file) => matches(file, source.accept)));
  };
  return (
    <label htmlFor={id} className={`${s.drop}${over ? ` ${s.over}` : ""}${busy ? ` ${s.busy}` : ""}`}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <input id={id} type="file" multiple accept={source.accept} className="sr-only" disabled={busy}
        onChange={(event) => { onFiles([...event.target.files ?? []]); event.target.value = ""; }} />
      <span className={s.dropIcon} aria-hidden="true"><IconFileUp /></span>
      {busy ? (
        <span className={s.dropTitle} role="status">{t("Lendo arquivos…")}</span>
      ) : (
        <>
          <span className={`${s.dropTitle} ${s.pointerOnly}`}>{t("Arraste os CSVs do")}{" "}{source.name} {" "}{t("para cá")}</span>
          <span className={`${s.dropTitle} ${s.touchOnly}`}>{t("Escolha os CSVs do")}{" "}{source.name}</span>
          <span className={s.sub}>
            <span className={s.pointerOnly}>{t("ou")}{" "}<span className={s.dropLink}>{t("escolha no computador")}</span> · </span>
            {t(source.fileKind)}{t(", um por projeto")}</span>
        </>
      )}
    </label>
  );
}

function Warnings({ items }: { items: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  return (
    <div className={s.warn}>
      <button type="button" className={s.warnToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconAlert />
        <span>{plural(items.length, t("ajuste"), t("ajustes"))} {" "}{t("ao trazer para o Feito")}</span>
        <IconChevronDown className="chev" />
      </button>
      <Collapse open={open} appear={false}>
        <ul className={s.warnList}>{items.map((item) => <li key={item}>{translateMessage(item)}</li>)}</ul>
      </Collapse>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className={s.stat}><span className={s.statN}>{value}</span><span className={s.statL}>{label}</span></div>;
}

function projectChips(project: SourceImportPreview["projects"][number], target?: Target) {
  const chips = [plural(project.tasks, t("tarefa"), t("tarefas"))];
  if (project.subtasks) chips.push(plural(project.subtasks, t("subtarefa"), t("subtarefas")));
  if (project.sections) chips.push(plural(project.sections, t("seção"), t("seções")));
  if (project.dated) chips.push(t("{0} com data", [project.dated]));
  if (project.recurring) chips.push(plural(project.recurring, t("recorrente"), t("recorrentes")));
  if (!target) chips.push(t(LAYOUT_LABEL[project.layout]));
  return chips;
}

/** Fluxo completo: escolher fonte e arquivos → revisar → resultado. Igual em Ajustes e no diálogo do projeto. */
export function ImportFlow({ variant, target, onClose }: { variant: Variant; target?: Target; onClose?: () => void }) {
  const t = useT();
  const app = useApp();
  const toast = useToast();
  const [sourceId, setSourceId] = useState(importSources[0].id);
  const source = importSources.find((item) => item.id === sourceId)!;
  const [files, setFiles] = useState<File[]>([]);
  const [body, setBody] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<SourceImportPreview | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [result, setResult] = useState<SourceImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const phase = result ? "done" : preview ? "review" : "pick";
  const footClass = `${s.actions}${variant === "dialog" ? ` ${s.dialogFoot}` : ""}`;

  const choose = async (picked: File[]) => {
    if (!picked.length) {
      setFailure(t("Escolha arquivos {0} exportados do {1}.", [source.accept.split(",")[0], source.name]));
      return;
    }
    const id = crypto.randomUUID();
    setFiles(picked);
    setPreview(null);
    setResult(null);
    setFailure(null);
    setOperationId(id);
    setBusy(true);
    try {
      const payload = await api.portability.sourceBody(picked, target?.id);
      setBody(payload);
      setPreview(await api.portability.sourcePreview(source.id, payload, id));
    } catch (error) {
      setFailure(error instanceof ApiFailure && error.code === "IMPORT_INVALID"
        ? (error.details?.errors as { message: string }[] | undefined)?.[0]?.message ?? errorMessage(error)
        : errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!body || !preview?.previewToken || !operationId) return;
    setBusy(true);
    setFailure(null);
    try {
      setResult(await api.portability.sourceConfirm(source.id, body, preview.previewToken, operationId));
      toast(t("Importação concluída"));
      void app.refresh();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "NETWORK_ERROR") {
        setFailure(t("A conexão caiu durante a importação. Verifique o resultado antes de tentar de novo."));
      } else {
        setFailure(error instanceof ApiFailure && error.code === "PREVIEW_EXPIRED" ? t("A prévia expirou. Escolha os arquivos de novo.") : errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!operationId) return;
    try {
      setResult(await api.portability.operation(operationId));
      setFailure(null);
      void app.refresh();
    } catch {
      setFailure(t("Nenhuma importação concluída com esta operação. Você pode tentar de novo."));
    }
  };

  const reset = () => {
    setFiles([]);
    setBody(null);
    setPreview(null);
    setResult(null);
    setFailure(null);
    setOperationId(null);
  };

  const failureNote = failure && <div className="field-error" role="alert">{translateMessage(failure)}</div>;

  if (phase === "done" && result) {
    const summary = result.summary;
    const labels = summary.labels ? t(" e {0}", [plural(summary.labels, t("etiqueta nova"), t("etiquetas novas"))]) : "";
    return (
      <div key="done" className={s.phase} role="status">
        <div className={s.done}>
          <div className={s.badge}><span><IconCheck /></span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h3 className={s.title} style={{ fontSize: 20 }}>{t("Tudo importado do")}{" "}{source.name}</h3>
            <p className={s.sub} style={{ fontSize: 14 }}>
              {target
                ? t("{0} em “{1}”{2}.", [plural(summary.tasks, t("tarefa entrou"), t("tarefas entraram")), target.name, labels])
                : t("{0} com {1}{2} já estão na sua barra lateral.", [plural(summary.projects, t("projeto novo"), t("projetos novos")), plural(summary.tasks, t("tarefa"), t("tarefas")), labels])}
            </p>
          </div>
          {!target && result.projectIds && preview && (
            <ul className={s.links}>
              {result.projectIds.map((id, index) => (
                <li key={id}>
                  <Link href={`/projetos/${id}`} className={s.link}>
                    <IconHash />
                    <span className={s.linkName}>{preview.projects[index]?.name}</span>
                    <span className={s.sub}>{plural(preview.projects[index]?.tasks ?? 0, t("tarefa"), t("tarefas"))}</span>
                    <IconChevronRight />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={footClass} style={{ justifyContent: "center" }}>
          <button type="button" className="btn" onClick={reset}>{t("Importar mais")}</button>
          {onClose && <button type="button" className="btn primary" onClick={onClose}>{t("Concluir")}</button>}
        </div>
      </div>
    );
  }

  if (phase === "review" && preview) {
    const counts = preview.counts;
    const projectsLabel = target ? null : plural(counts?.projects ?? 0, t("projeto"), t("projetos"));
    return (
      <div key="review" className={s.phase}>
        <div className={s.head} style={{ alignItems: "center" }}>
          <Monogram name={source.name} />
          <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
            <h3 className={s.title}>{counts ? t("Pronto para importar do {0}", [source.name]) : t("Não deu para ler os arquivos")}</h3>
            <span className={s.sub}>{counts ? t("Revise o que vai entrar. Nada mudou ainda.") : t("Corrija os pontos abaixo ou escolha outros arquivos.")}</span>
          </div>
          <button type="button" className="btn ghost" disabled={busy} onClick={reset} style={{ color: "var(--accent-text)" }}>{t("Trocar arquivos")}</button>
        </div>

        {counts && (
          <div className={s.stats}>
            {target ? <Stat value={counts.tasks} label={counts.tasks === 1 ? t("tarefa") : t("tarefas")} />
              : <Stat value={counts.projects} label={counts.projects === 1 ? t("projeto novo") : t("projetos novos")} />}
            {target ? <Stat value={preview.projects[0]?.subtasks ?? 0} label="subtarefas" />
              : <Stat value={counts.tasks} label={counts.tasks === 1 ? t("tarefa") : t("tarefas")} />}
            <Stat value={counts.sections} label={counts.sections === 1 ? t("seção") : t("seções")} />
            <Stat value={counts.labels} label={counts.labels === 1 ? t("etiqueta nova") : t("etiquetas novas")} />
          </div>
        )}

        {preview.projects.length > 0 && (
          <ul className={s.files}>
            {preview.projects.map((project, index) => (
              <li key={`${project.name}:${index}`} className={s.file}>
                <IconHash />
                <div className={s.fileBody}>
                  <div className={s.fileName}>
                    <strong>{project.name}</strong>
                    <span className={s.fileSrc}>{target ? files.map((file) => file.name).join(", ") : files[index]?.name}</span>
                  </div>
                  <div className={s.chips}>{projectChips(project, target).map((chip) => <span key={chip} className={s.chip}>{chip}</span>)}</div>
                </div>
                <IconCheck className={s.ok} />
              </li>
            ))}
          </ul>
        )}

        {preview.errors.length > 0 && (
          <div className={s.errors}>
            {preview.errors.slice(0, 6).map((item) => (
              <div key={item.path + item.message} className="field-error"><code>{item.path || t("arquivo")}</code>: {translateMessage(item.message)}</div>
            ))}
            {preview.errors.length > 6 && <div className="field-error">{t("e mais")}{" "}{preview.errors.length - 6} {" "}{t("erros.")}</div>}
          </div>
        )}
        {preview.warnings.length > 0 && <Warnings items={preview.warnings} />}
        {failureNote}

        <div className={footClass}>
          <span className={s.hint}>{t("Nada do que já existe é alterado.")}</span>
          {failure && operationId && preview.previewToken && <button type="button" className="btn ghost" onClick={() => void check()}>{t("Verificar resultado")}</button>}
          <button type="button" className="btn" disabled={busy} onClick={onClose ?? reset}>{t("Cancelar")}</button>
          <button type="button" className="btn primary" disabled={busy || !preview.previewToken} onClick={() => void confirm()}>
            <IconUpload />
            {busy ? t("Importando…") : t("Importar {0}", [target ? plural(counts?.tasks ?? 0, t("tarefa"), t("tarefas")) : projectsLabel])}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div key="pick" className={s.phase}>
      {variant === "panel" || importSources.length > 1 ? (
        <SourceChoices selected={sourceId} onSelect={setSourceId} />
      ) : (
        <div className={s.source}>
          <Monogram name={source.name} small />
          <span className={s.choiceText}>
            <span className={s.choiceName}>{source.name}</span>
            <span className={s.sub} style={{ fontSize: 12 }}>{t(source.fileKind)}</span>
          </span>
        </div>
      )}
      {(variant === "panel" || !target) && <Steps source={source} />}
      <DropZone source={source} busy={busy} onFiles={(picked) => void choose(picked)} />
      {failureNote}
      {target && (
        <div className={s.notes}>
          <div className={s.note}><IconPlus /><span>{t("Tarefas e seções entram")}{" "}<b>{t("no fim do projeto")}</b>.</span></div>
          <div className={s.note}><IconLock /><span>{t("O que já existe em “")}{target.name}” <b>{t("não muda")}</b>.</span></div>
        </div>
      )}
      {variant === "dialog" && (
        <div className={footClass}>
          <button type="button" className="btn" onClick={onClose}>{t("Cancelar")}</button>
          <button type="button" className="btn primary" disabled>{t("Importar")}</button>
        </div>
      )}
    </div>
  );
}

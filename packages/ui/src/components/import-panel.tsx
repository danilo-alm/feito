"use client";
import { Link } from "../navigation";
import { useState, type DragEvent, type ReactNode } from "react";
import { api, ApiFailure, errorMessage } from "../client/api";
import type { SourceImportPreview, SourceImportResult } from "@feito/core/types";
import { useApp } from "./app";
import {
  IconAlert, IconCheck, IconChevronDown, IconChevronRight, IconFileUp, IconHash, IconLock, IconPlus, IconUpload, IconX,
} from "./icons";
import { Collapse } from "./motion";
import { Dialog, useToast } from "./ui";
import { importSources, type ImportSource } from "@feito/core/domain/import-sources";
import s from "./import-export.module.css";

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

type Target = { id: string; name: string };
type Variant = "panel" | "dialog";

export function Monogram({ name, small }: { name: string; small?: boolean }) {
  return <span className={`${s.monogram}${small ? ` ${s.small}` : ""}`} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>;
}

/** Cabeçalho dos diálogos de importar e exportar: rótulo da ação, nome do projeto e fechar. */
export function DialogHead({ eyebrow, title, id, onClose }: { eyebrow: string; title: string; id: string; onClose: () => void }) {
  return (
    <div className={s.dialogHead}>
      <div>
        <span className={s.label}>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar (Esc)"><IconX /></button>
    </div>
  );
}

function SourceChoices({ selected, onSelect }: { selected: ImportSource["id"]; onSelect: (id: ImportSource["id"]) => void }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className={s.label} style={{ padding: 0, marginBottom: 8 }}>De onde vêm os dados</legend>
      <div className={s.choices} role="radiogroup" aria-label="De onde vêm os dados">
        {importSources.map((item) => (
          <button key={item.id} type="button" role="radio" aria-checked={item.id === selected} className={s.choice}
            onClick={() => onSelect(item.id)}>
            <Monogram name={item.name} />
            <span className={s.choiceText}>
              <span className={s.choiceName}>{item.name}</span>
              <span className={s.sub} style={{ fontSize: 12 }}>{item.fileKind}</span>
            </span>
            <span className={s.tick} aria-hidden="true"><IconCheck /></span>
          </button>
        ))}
        <div className={s.soon}>
          <span className={s.soonIcon} aria-hidden="true"><IconPlus /></span>
          Outros apps chegam em breve
        </div>
      </div>
    </fieldset>
  );
}

function Steps({ source }: { source: ImportSource }) {
  return (
    <ol className={s.steps} aria-label="Como importar">
      {source.steps.map((step, index) => (
        <li key={step.title} className={s.step}>
          <span className={s.stepN} aria-hidden="true">{index + 1}</span>
          <span className={s.stepTitle}>{step.title}</span>
          <span className={s.stepBody}>{step.body}</span>
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
        <span className={s.dropTitle} role="status">Lendo arquivos…</span>
      ) : (
        <>
          <span className={`${s.dropTitle} ${s.pointerOnly}`}>Arraste os CSVs do {source.name} para cá</span>
          <span className={`${s.dropTitle} ${s.touchOnly}`}>Escolha os CSVs do {source.name}</span>
          <span className={s.sub}>
            <span className={s.pointerOnly}>ou <span className={s.dropLink}>escolha no computador</span> · </span>
            {source.fileKind}, um por projeto
          </span>
        </>
      )}
    </label>
  );
}

function Warnings({ items }: { items: string[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={s.warn}>
      <button type="button" className={s.warnToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconAlert />
        <span>{plural(items.length, "ajuste", "ajustes")} ao trazer para o Feito</span>
        <IconChevronDown className="chev" />
      </button>
      <Collapse open={open} appear={false}>
        <ul className={s.warnList}>{items.map((item) => <li key={item}>{item}</li>)}</ul>
      </Collapse>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className={s.stat}><span className={s.statN}>{value}</span><span className={s.statL}>{label}</span></div>;
}

function projectChips(project: SourceImportPreview["projects"][number], target?: Target) {
  const chips = [plural(project.tasks, "tarefa", "tarefas")];
  if (project.subtasks) chips.push(plural(project.subtasks, "subtarefa", "subtarefas"));
  if (project.sections) chips.push(plural(project.sections, "seção", "seções"));
  if (project.dated) chips.push(`${project.dated} com data`);
  if (project.recurring) chips.push(plural(project.recurring, "recorrente", "recorrentes"));
  if (!target) chips.push(project.layout === "board" ? "Painel" : "Lista");
  return chips;
}

/** Fluxo completo: escolher fonte e arquivos → revisar → resultado. Igual em Ajustes e no diálogo do projeto. */
function ImportFlow({ variant, target, onClose }: { variant: Variant; target?: Target; onClose?: () => void }) {
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
      setFailure(`Escolha arquivos ${source.accept.split(",")[0]} exportados do ${source.name}.`);
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
      toast("Importação concluída");
      void app.refresh();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "NETWORK_ERROR") {
        setFailure("A conexão caiu durante a importação. Verifique o resultado antes de tentar de novo.");
      } else {
        setFailure(error instanceof ApiFailure && error.code === "PREVIEW_EXPIRED" ? "A prévia expirou. Escolha os arquivos de novo." : errorMessage(error));
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
      setFailure("Nenhuma importação concluída com esta operação. Você pode tentar de novo.");
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

  const failureNote = failure && <div className="field-error" role="alert">{failure}</div>;

  if (phase === "done" && result) {
    const summary = result.summary;
    const labels = summary.labels ? ` e ${plural(summary.labels, "etiqueta nova", "etiquetas novas")}` : "";
    return (
      <div key="done" className={s.phase} role="status">
        <div className={s.done}>
          <div className={s.badge}><span><IconCheck /></span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h3 className={s.title} style={{ fontSize: 20 }}>Tudo importado do {source.name}</h3>
            <p className={s.sub} style={{ fontSize: 14 }}>
              {target
                ? `${plural(summary.tasks, "tarefa entrou", "tarefas entraram")} em “${target.name}”${labels}.`
                : `${plural(summary.projects, "projeto novo", "projetos novos")} com ${plural(summary.tasks, "tarefa", "tarefas")}${labels} já estão na sua barra lateral.`}
            </p>
          </div>
          {!target && result.projectIds && preview && (
            <ul className={s.links}>
              {result.projectIds.map((id, index) => (
                <li key={id}>
                  <Link href={`/projetos/${id}`} className={s.link}>
                    <IconHash />
                    <span className={s.linkName}>{preview.projects[index]?.name}</span>
                    <span className={s.sub}>{plural(preview.projects[index]?.tasks ?? 0, "tarefa", "tarefas")}</span>
                    <IconChevronRight />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={footClass} style={{ justifyContent: "center" }}>
          <button type="button" className="btn" onClick={reset}>Importar mais</button>
          {onClose && <button type="button" className="btn primary" onClick={onClose}>Concluir</button>}
        </div>
      </div>
    );
  }

  if (phase === "review" && preview) {
    const counts = preview.counts;
    const projectsLabel = target ? null : plural(counts?.projects ?? 0, "projeto", "projetos");
    return (
      <div key="review" className={s.phase}>
        <div className={s.head} style={{ alignItems: "center" }}>
          <Monogram name={source.name} />
          <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
            <h3 className={s.title}>{counts ? `Pronto para importar do ${source.name}` : "Não deu para ler os arquivos"}</h3>
            <span className={s.sub}>{counts ? "Revise o que vai entrar. Nada mudou ainda." : "Corrija os pontos abaixo ou escolha outros arquivos."}</span>
          </div>
          <button type="button" className="btn ghost" disabled={busy} onClick={reset} style={{ color: "var(--brand-text)" }}>Trocar arquivos</button>
        </div>

        {counts && (
          <div className={s.stats}>
            {target ? <Stat value={counts.tasks} label={counts.tasks === 1 ? "tarefa" : "tarefas"} />
              : <Stat value={counts.projects} label={counts.projects === 1 ? "projeto novo" : "projetos novos"} />}
            {target ? <Stat value={preview.projects[0]?.subtasks ?? 0} label="subtarefas" />
              : <Stat value={counts.tasks} label={counts.tasks === 1 ? "tarefa" : "tarefas"} />}
            <Stat value={counts.sections} label={counts.sections === 1 ? "seção" : "seções"} />
            <Stat value={counts.labels} label={counts.labels === 1 ? "etiqueta nova" : "etiquetas novas"} />
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
              <div key={item.path + item.message} className="field-error"><code>{item.path || "arquivo"}</code>: {item.message}</div>
            ))}
            {preview.errors.length > 6 && <div className="field-error">e mais {preview.errors.length - 6} erros.</div>}
          </div>
        )}
        {preview.warnings.length > 0 && <Warnings items={preview.warnings} />}
        {failureNote}

        <div className={footClass}>
          <span className={s.hint}>Nada do que já existe é alterado.</span>
          {failure && operationId && preview.previewToken && <button type="button" className="btn ghost" onClick={() => void check()}>Verificar resultado</button>}
          <button type="button" className="btn" disabled={busy} onClick={onClose ?? reset}>Cancelar</button>
          <button type="button" className="btn primary" disabled={busy || !preview.previewToken} onClick={() => void confirm()}>
            <IconUpload />
            {busy ? "Importando…" : `Importar ${target ? plural(counts?.tasks ?? 0, "tarefa", "tarefas") : projectsLabel}`}
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
            <span className={s.sub} style={{ fontSize: 12 }}>{source.fileKind}</span>
          </span>
        </div>
      )}
      {(variant === "panel" || !target) && <Steps source={source} />}
      <DropZone source={source} busy={busy} onFiles={(picked) => void choose(picked)} />
      {failureNote}
      {target && (
        <div className={s.notes}>
          <div className={s.note}><IconPlus /><span>Tarefas e seções entram <b>no fim do projeto</b>.</span></div>
          <div className={s.note}><IconLock /><span>O que já existe em “{target.name}” <b>não muda</b>.</span></div>
        </div>
      )}
      {variant === "dialog" && (
        <div className={footClass}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn primary" disabled>Importar</button>
        </div>
      )}
    </div>
  );
}

/**
 * Diálogo de importação. Com `target`, acrescenta ao fim de um projeto existente; sem ele, cria projetos novos
 * (Ajustes). Devolve o elemento e a função que o abre.
 */
export function useImportDialog(): [ReactNode, (target?: Target) => void] {
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const close = () => setOpen(false);
  const sourceNames = importSources.map((item) => item.name).join(", ");
  const element = (
    <Dialog open={open} onClose={close} title={target ? `Importar para ${target.name}` : `Importar do ${sourceNames}`}
      labelledBy="import-dialog-h" hideHeader width={600}>
      {session > 0 && (
        <>
          <DialogHead eyebrow={target ? "Importar para" : "Importar de outro app"} title={target?.name ?? sourceNames}
            id="import-dialog-h" onClose={close} />
          <div className={s.dialogBody}>
            <ImportFlow key={`${target?.id ?? "novo"}:${session}`} variant="dialog" target={target ?? undefined} onClose={close} />
          </div>
        </>
      )}
    </Dialog>
  );
  return [element, (next) => { setSession((value) => value + 1); setTarget(next ?? null); setOpen(true); }];
}

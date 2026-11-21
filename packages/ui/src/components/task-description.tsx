"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { formatDescription, type DescriptionFormat } from "../client/description-formatting";
import { IconBold, IconBulletList, IconCode, IconHeading, IconItalic, IconLink, IconNumberList, IconQuote, IconStrike, IconTaskList } from "./icons";
import { useT } from "./language";
import { Collapse } from "./motion";
import { TaskMarkdown } from "./task-markdown";
import { useAutoGrow } from "./ui";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "children" | "onChange" | "onBlur"> & {
  value: string;
  defaultPreview?: boolean;
  /** Mostra a barra de formatação; só o popup de detalhes a usa. */
  toolbar?: boolean;
  onValueChange: (value: string) => void;
  onCommit?: () => void;
};

const formats = [
  ["heading", "Título de nível 1", IconHeading], ["bold", "Negrito", IconBold],
  ["italic", "Itálico", IconItalic], ["strike", "Tachado", IconStrike], ["link", "Inserir link", IconLink],
  ["list", "Lista com marcadores", IconBulletList], ["ordered", "Lista numerada", IconNumberList], ["task", "Lista de tarefas", IconTaskList],
  ["quote", "Citação", IconQuote], ["code", "Código", IconCode],
] as const;

export function TaskDescription({ value, defaultPreview = false, toolbar = false, readOnly, onValueChange, onCommit, ...props }: Props) {
  const t = useT();
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const [preview, setPreview] = useState(defaultPreview && !!value);
  const focusEditor = useRef(false);
  const editor = useRef<HTMLTextAreaElement | null>(null);
  const input = useAutoGrow(value);
  const showingPreview = readOnly || preview;
  const selection = useRef<{ start: number; end: number } | null>(null);
  const [limitError, setLimitError] = useState(false);
  const pointerActive = useRef(false);
  const previewPending = useRef(false);

  useEffect(() => {
    if (showingPreview) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const down = () => { pointerActive.current = true; };
    const up = () => {
      pointerActive.current = false;
      timer = setTimeout(() => { if (previewPending.current) setPreview(true); }, 0);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      clearTimeout(timer);
      pointerActive.current = false;
      previewPending.current = false;
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
    };
  }, [showingPreview]);

  useLayoutEffect(() => {
    if (selection.current && editor.current) {
      editor.current.focus();
      editor.current.setSelectionRange(selection.current.start, selection.current.end);
      selection.current = null;
    }
  }, [value]);

  const format = (kind: DescriptionFormat) => {
    const element = editor.current;
    if (!element) return;
    const result = formatDescription(value, element.selectionStart, element.selectionEnd, kind, t("texto"));
    if (result.value.length > (props.maxLength ?? 10_000)) { setLimitError(true); element.focus(); return; }
    setLimitError(false);
    selection.current = result;
    if (result.value === value) {
      element.focus();
      element.setSelectionRange(result.start, result.end);
      selection.current = null;
    } else {
      // A operação nativa mantém a formatação no histórico de desfazer do textarea.
      let from = 0;
      while (from < value.length && from < result.value.length && value[from] === result.value[from]) from++;
      let suffix = 0;
      while (suffix < value.length - from && suffix < result.value.length - from
        && value[value.length - suffix - 1] === result.value[result.value.length - suffix - 1]) suffix++;
      element.focus();
      element.setSelectionRange(from, value.length - suffix);
      if (typeof document.execCommand === "function") {
        document.execCommand("insertText", false, result.value.slice(from, result.value.length - suffix));
      }
      onValueChange(result.value);
    }
  };

  useEffect(() => {
    if (!showingPreview && focusEditor.current) {
      editor.current?.focus();
      focusEditor.current = false;
    }
  }, [showingPreview, input]);

  return (
    <div className="task-description" onFocus={() => { previewPending.current = false; }} onBlur={(event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      if (!showingPreview) {
        onCommit?.();
        // A barra não pode desaparecer entre pressionar e soltar o botão de salvar.
        if (pointerActive.current) previewPending.current = true;
        else setPreview(true);
      }
    }}>
      {showingPreview ? <div role="region" aria-label={t("Descrição")}
        className={readOnly ? undefined : "task-description-preview"} tabIndex={readOnly ? undefined : 0}
        onClick={(event) => {
          if (readOnly || (event.target as HTMLElement).closest("a") || !window.getSelection()?.isCollapsed) return;
          focusEditor.current = true;
          setPreview(false);
        }}
        onKeyDown={(event) => {
          if (readOnly || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          focusEditor.current = true;
          setPreview(false);
        }}>
        {value ? <TaskMarkdown>{value}</TaskMarkdown> : <p className="hint">{t(readOnly ? "Sem descrição." : "Descrição")}</p>}
      </div> : <>
        <label htmlFor={id} className="sr-only">{t("Descrição")}</label>
        <textarea {...props} id={id} ref={(element) => { editor.current = element; input(element); }} value={value} rows={1} maxLength={10_000}
          onChange={(event) => { setLimitError(false); onValueChange(event.target.value); }}
          onKeyDown={(event) => {
            const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
              ? ({ b: "bold", i: "italic", k: "link" } as const)[event.key.toLowerCase() as "b" | "i" | "k"] : undefined;
            if (shortcut) { event.preventDefault(); event.stopPropagation(); format(shortcut); }
            else props.onKeyDown?.(event);
          }} />
        {limitError && <p className="hint" role="status">{t("A descrição atingiu o limite de {0} caracteres.", [props.maxLength ?? 10_000])}</p>}
      </>}
      <Collapse open={toolbar && !showingPreview} appear={false}>
        <div className="description-formatting" role="group" aria-label={t("Formatação da descrição")}>
          {formats.map(([kind, label, Icon]) => <button key={kind} type="button" className="icon-btn"
            aria-label={t(label)} data-tooltip={t(label)} aria-controls={id}
            onPointerDown={(event) => { if (event.pointerType === "mouse") event.preventDefault(); }}
            onClick={() => format(kind)}><Icon /></button>)}
        </div>
      </Collapse>
    </div>
  );
}

"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import type { TaskComment, TaskComments as Comments, TaskDetail } from "@feito/core/types";
import { commentsKey, createComment, editComment, isTemporaryComment, loadComments, removeComment } from "../client/comment-mutations";
import { commentTimeLabel } from "../client/dates";
import { useQuery } from "../client/store";
import { useApp } from "./app";
import { IconArrowUp, IconChevronDown, IconEdit, IconMore, IconTrash } from "./icons";
import { useT } from "./language";
import { Collapse } from "./motion";
import { TaskMarkdown } from "./task-markdown";
import { MenuButton, ReadFallback, useAutoGrow } from "./ui";

const MAX_COMMENT = 10_000;

/** Nome e inicial do autor: a conta tem um único usuário, e o espaço local não tem e-mail. */
function useAuthor() {
  const t = useT();
  const email = useApp().me.user.email;
  const name = email ? email.split("@")[0] : t("Você");
  return { name, initial: (name.trim()[0] ?? "?").toLocaleUpperCase() };
}

function Avatar({ initial }: { initial: string }) {
  return <span className="cm-avatar" aria-hidden="true">{initial}</span>;
}

/**
 * Comentários da tarefa: lista recolhível e, no computador, o campo para comentar logo abaixo.
 * No celular o campo (`CommentComposer`) fica fora da seção para ficar preso ao pé da folha.
 */
export function TaskComments({ task, variant }: { task: TaskDetail; variant: "desktop" | "mobile" }) {
  const t = useT();
  const query = useQuery<Comments>(commentsKey(task.id), () => loadComments(task.id));
  const comments = query.data?.comments ?? [];
  const count = query.data ? comments.length : task.commentCount;
  const [open, setOpen] = useState(true);

  return (
    <section className={`cm cm-${variant}`} aria-label={t("Comentários")}>
      {count > 0 && (
        <button type="button" className="td-sec-h cm-h" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <IconChevronDown className={open ? undefined : "md-rot"} aria-hidden="true" />
          <span className="td-sec-t">{t("Comentários")}</span>
          <span className="sub">{count}</span>
        </button>
      )}
      {count > 0 && (
        <Collapse open={open} appear={false}>
          {!query.data ? <ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} /> : (
            <ul className="cm-list">
              {comments.map((comment) => <CommentItem key={comment.id} comment={comment} />)}
            </ul>
          )}
        </Collapse>
      )}
      {variant === "desktop" && <CommentComposer taskId={task.id} />}
    </section>
  );
}

function CommentItem({ comment }: { comment: TaskComment }) {
  const t = useT();
  const app = useApp();
  const author = useAuthor();
  const [draft, setDraft] = useState<string | null>(null);
  const pending = isTemporaryComment(comment.id);
  const time = commentTimeLabel(comment.createdAt, app.reference, app.timezone);

  const remove = async () => {
    const ok = await app.confirm({
      title: t("Excluir comentário?"),
      body: t("A exclusão é permanente e não dá para desfazer."),
      confirmLabel: t("Excluir"),
      danger: true,
    });
    if (ok) await app.run(() => removeComment(comment));
  };

  const save = () => {
    const body = draft?.trim() ?? "";
    if (!body) return;
    setDraft(null);
    if (body !== comment.body) void app.run(() => editComment(comment, body));
  };

  return (
    <li className={`cm-item${pending ? " pending" : ""}`}>
      <Avatar initial={author.initial} />
      <div className="cm-main">
        <div className="cm-meta">
          <span className="cm-name">{author.name}</span>
          <time dateTime={comment.createdAt}>{time}</time>
          {comment.editedAt && <span className="cm-edited">{t("(editado)")}</span>}
          {draft === null && (
            <MenuButton className="icon-btn cm-menu" label={t("Ações do comentário")} items={() => [
              { label: t("Editar"), icon: <IconEdit />, onSelect: () => setDraft(comment.body) },
              "separator",
              { label: t("Excluir"), icon: <IconTrash />, danger: true, onSelect: () => void remove() },
            ]}><IconMore /></MenuButton>
          )}
        </div>
        {draft === null ? <div className="cm-body"><TaskMarkdown>{comment.body}</TaskMarkdown></div> : (
          <div className="cm-edit">
            <CommentField value={draft} label={t("Editar comentário")} autoFocus onChange={setDraft} onSubmit={save}
              onCancel={() => setDraft(null)} />
            <div className="cm-edit-actions">
              <button type="button" className="btn ghost" onClick={() => setDraft(null)}>{t("Cancelar")}</button>
              <button type="button" className="btn primary" disabled={!draft.trim()} onClick={save}>{t("Salvar")}</button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export function CommentComposer({ taskId }: { taskId: string }) {
  const t = useT();
  const app = useApp();
  const author = useAuthor();
  const [draft, setDraft] = useState("");
  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    const created = await app.run(() => createComment(taskId, body));
    // A escrita falhou: devolve o texto ao campo se ele continua vazio.
    if (!created) setDraft((current) => current || body);
  };
  return (
    <div className="cm-composer">
      <Avatar initial={author.initial} />
      <div className="cm-input">
        <CommentField value={draft} label={t("Comentar")} placeholder={t("Comentar")} onChange={setDraft} onSubmit={() => void send()}
          onCancel={(field) => field.blur()} />
        {draft.trim() && (
          <button type="button" className="cm-send" aria-label={t("Enviar comentário")} onClick={() => void send()}><IconArrowUp /></button>
        )}
      </div>
    </div>
  );
}

/** Enter envia e Shift+Enter quebra a linha; Esc cancela sem fechar o diálogo. */
function CommentField({ value, label, placeholder, autoFocus, onChange, onSubmit, onCancel }: {
  value: string; label: string; placeholder?: string; autoFocus?: boolean;
  onChange: (value: string) => void; onSubmit: () => void; onCancel: (field: HTMLTextAreaElement) => void;
}) {
  const grow = useAutoGrow(value);
  const ref = useCallback((element: HTMLTextAreaElement | null) => {
    grow(element);
    // Ao editar, o cursor começa no fim do texto.
    if (element && autoFocus) {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, [grow, autoFocus]);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    } else if (event.key === "Escape" && (value || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      event.stopPropagation();
      onCancel(event.currentTarget);
    }
  };
  return (
    <textarea ref={ref} className="cm-field" rows={1} value={value} aria-label={label} placeholder={placeholder}
      maxLength={MAX_COMMENT} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
  );
}

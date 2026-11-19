"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, errorMessage } from "@/client/api";
import { useQuery } from "@/client/store";
import type { ProjectShare } from "@/client/types";
import { IconCheck, IconDuplicate, IconExternal, IconEye, IconGlobe, IconLink, IconShare } from "./icons";
import { Dialog, Popover, useIsMobile, useToast } from "./ui";

/** Rota pública do front para um projeto compartilhado (docs/02-backend-endpoints.md, compartilhamento). */
export const publicProjectPath = (token: string) => `/compartilhado/${encodeURIComponent(token)}`;

export const shareKey = (projectId: string) => `share:${projectId}`;

/** Estado do link público do projeto; compartilhado entre o botão da barra e o selo do título. */
export function useProjectShare(projectId: string, enabled = true) {
  return useQuery<ProjectShare>(enabled ? shareKey(projectId) : null, () => api.projects.share(projectId));
}

async function copyText(text: string, fallback: HTMLInputElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sem permissão de área de transferência: seleciona o campo para o Ctrl/Cmd+C manual.
    fallback?.focus();
    fallback?.select();
    return false;
  }
}

export function ShareMenu({ projectId, archived }: { projectId: string; archived: boolean }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const share = useProjectShare(projectId);
  const shared = !!share.data?.enabled;
  const close = () => setOpen(false);

  const body = <ShareBody projectId={projectId} archived={archived} share={share} mobile={mobile} onClose={close} />;

  return (
    <>
      <button ref={setAnchor} type="button" className={`icon-btn tool-btn${open ? " on" : ""}${shared ? " shared" : ""}`}
        aria-label={shared ? "Compartilhar: link público ativo" : "Compartilhar"} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <IconShare />
        <span className="tool-label">Compartilhar</span>
      </button>
      {mobile
        ? <Dialog open={open} onClose={close} title="Compartilhar">{body}</Dialog>
        : <Popover anchor={anchor} open={open} onClose={close} label="Compartilhar" align="end" width={380}>{body}</Popover>}
    </>
  );
}

function ShareBody({ projectId, archived, share, mobile, onClose }: {
  projectId: string;
  archived: boolean;
  share: ReturnType<typeof useProjectShare>;
  mobile: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const token = share.data?.enabled ? share.data.token : null;
  const shared = !!token;
  const url = token ? `${window.location.origin}${publicProjectPath(token)}` : "";
  const canNativeShare = mobile && typeof navigator !== "undefined" && typeof navigator.share === "function";

  const toggle = async () => {
    if (busy || archived || !share.data) return;
    setBusy(true);
    setCopied(false);
    try {
      if (shared) {
        await api.projects.disableShare(projectId);
        share.mutate(() => ({ enabled: false, token: null }));
        toast("Link desativado. Quem tinha o link perde o acesso.");
      } else {
        const next = await api.projects.enableShare(projectId);
        share.mutate(() => next);
        toast("Link público ativado");
      }
    } catch (error) {
      toast(error instanceof ApiFailure && error.code === "PROJECT_ARCHIVED"
        ? "Projetos arquivados não podem ser compartilhados." : errorMessage(error), { bad: true });
      void share.reload();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    if (await copyText(url, field.current)) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } else {
      toast("Não foi possível copiar. O link está selecionado para copiar manualmente.", { bad: true });
    }
  };

  const status = archived ? "Reative o projeto para compartilhar."
    : !share.data ? (share.error ? "Não foi possível carregar o compartilhamento." : "Carregando…")
      : shared ? "Ativado. Qualquer pessoa com o link pode ver este projeto." : "Desativado. Só você vê este projeto.";

  return (
    <div className="share" style={{ padding: mobile ? "8px 16px 24px" : "16px 18px 14px" }}>
      {!mobile && <h2 className="share-h">Compartilhar</h2>}
      <div className="share-row">
        <span className={`share-ico${shared ? " on" : ""}`} aria-hidden="true"><IconGlobe /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div id="share-public-label" style={{ fontWeight: 600 }}>Link público</div>
          <div className="share-status" aria-live="polite">{status}</div>
        </div>
        <button type="button" className={`switch${shared ? " on" : ""}`} role="switch" aria-checked={shared}
          aria-labelledby="share-public-label" disabled={busy || archived || !share.data} aria-busy={busy}
          onClick={() => void toggle()} />
      </div>

      {shared && (
        <div className="share-link">
          <div className="share-copy">
            <label htmlFor="share-url" className="sr-only">Link do projeto</label>
            <input ref={field} id="share-url" className="input share-url" readOnly value={url}
              onFocus={(event) => event.currentTarget.select()} />
            {!mobile && <CopyButton copied={copied} onClick={() => void copy()} />}
          </div>
          {mobile ? (
            <div className="share-actions">
              {canNativeShare && (
                <button type="button" className="btn lg" onClick={() => void navigator.share({ url }).catch(() => undefined)}>
                  <IconShare />Enviar…
                </button>
              )}
              <CopyButton copied={copied} onClick={() => void copy()} large />
            </div>
          ) : (
            <a className="share-open" href={publicProjectPath(token)} target="_blank" rel="noopener noreferrer" onClick={onClose}>
              Abrir página pública<IconExternal />
            </a>
          )}
        </div>
      )}

      <div className="msep" style={{ margin: mobile ? "0 -16px" : "0 -18px" }} />
      <ul className="share-notes">
        <li><IconEye />Só leitura: quem abre vê seções, tarefas, descrições e etiquetas, sem entrar na sua conta.</li>
        <li><IconLink />Desativar invalida o link na hora. Ao ativar de novo, um link novo é gerado. Arquivar o projeto também desativa.</li>
      </ul>
    </div>
  );
}

function CopyButton({ copied, onClick, large }: { copied: boolean; onClick: () => void; large?: boolean }) {
  return (
    <button type="button" className={`btn share-copy-btn${large ? " lg" : ""}${copied ? " copied" : " primary"}`} onClick={onClick}>
      {copied ? <IconCheck /> : <IconDuplicate />}
      <span aria-live="polite">{copied ? "Copiado" : "Copiar link"}</span>
    </button>
  );
}

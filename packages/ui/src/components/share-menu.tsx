"use client";
import { useT } from "./language";

import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, errorMessage } from "../client/api";
import { useQuery } from "../client/store";
import type { ProjectShare } from "@feito/core/types";
import { IconCheck, IconDuplicate, IconExternal, IconEye, IconGlobe, IconLink, IconShare } from "./icons";
import { Dialog, Popover, useIsMobile, useToast } from "./ui";

/** Rota pública do front para um projeto compartilhado (docs/02-backend-endpoints.md, compartilhamento). */
export const publicProjectPath = (token: string) => `/compartilhado/${encodeURIComponent(token)}`;

export type ProjectSharing =
  | { origin: string; openPublicPage: (token: string) => Promise<void>; unavailable?: never }
  | { unavailable: string; origin?: never; openPublicPage?: never };

/** Estado do link público do projeto; compartilhado entre o botão da barra e o selo do título. */
export function useProjectShare(projectId: string, enabled = true, origin?: string) {
  const key = origin ? `share:${origin}:${projectId}` : `share:${projectId}`;
  return useQuery<ProjectShare>(enabled ? key : null, () => api.projects.share(projectId));
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

export function ShareMenu({ projectId, archived, sharing }: {
  projectId: string;
  archived: boolean;
  sharing?: ProjectSharing;
}) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const unavailable = sharing?.unavailable;
  const share = useProjectShare(projectId, !unavailable, sharing?.origin);
  const shared = !archived && !!share.data?.enabled;
  const close = () => setOpen(false);

  const body = unavailable
    ? <div className="share" style={{ padding: mobile ? "8px 16px 24px" : "16px 18px" }}>
        {!mobile && <h2 className="share-h">{t("Compartilhar")}</h2>}
        <p className="share-status">{unavailable}</p>
      </div>
    : <ShareBody projectId={projectId} archived={archived} share={share} mobile={mobile} sharing={sharing} onClose={close} />;

  return (
    <>
      <button ref={setAnchor} type="button" className={`icon-btn tool-btn${open ? " on" : ""}${shared ? " shared" : ""}`}
        data-share-unavailable={unavailable ? "" : undefined} data-tooltip={unavailable ?? t("Compartilhar")} aria-description={unavailable}
        aria-label={shared ? t("Compartilhar: link público ativo") : t("Compartilhar")} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => {
          if (!open && sharing?.origin && !share.loading) void share.reload();
          setOpen(!open);
        }}>
        <IconShare />
        <span className="tool-label">{t("Compartilhar")}</span>
      </button>
      {mobile
        ? <Dialog open={open} onClose={close} title={t("Compartilhar")}>{body}</Dialog>
        : <Popover anchor={anchor} open={open} onClose={close} label={t("Compartilhar")} align="end" width={380}>{body}</Popover>}
    </>
  );
}

function ShareBody({ projectId, archived, share, mobile, sharing, onClose }: {
  projectId: string;
  archived: boolean;
  share: ReturnType<typeof useProjectShare>;
  mobile: boolean;
  sharing?: ProjectSharing;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const token = !archived && share.data?.enabled ? share.data.token : null;
  const shared = !!token;
  const url = token ? `${sharing?.origin ?? window.location.origin}${publicProjectPath(token)}` : "";
  const openPublicPage = sharing?.openPublicPage;
  const canNativeShare = mobile && !openPublicPage && typeof navigator !== "undefined" && typeof navigator.share === "function";

  const toggle = async () => {
    if (busy || archived || !share.data) return;
    setBusy(true);
    setCopied(false);
    try {
      if (shared) {
        await api.projects.disableShare(projectId);
        share.mutate(() => ({ enabled: false, token: null }));
        toast(t("Link desativado. Quem tinha o link perde o acesso."));
      } else {
        const next = await api.projects.enableShare(projectId);
        share.mutate(() => next);
        toast(t("Link público ativado"));
      }
    } catch (error) {
      toast(error instanceof ApiFailure && error.code === "PROJECT_ARCHIVED"
        ? t("Projetos arquivados não podem ser compartilhados.") : errorMessage(error), { bad: true });
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
      toast(t("Não foi possível copiar. O link está selecionado para copiar manualmente."), { bad: true });
    }
  };

  const status = archived ? t("Reative o projeto para compartilhar.")
    : share.error && !share.loading ? errorMessage(share.error)
      : !share.data ? t("Carregando…")
      : shared ? t("Ativado. Qualquer pessoa com o link pode ver este projeto.") : t("Desativado. Só você vê este projeto.");

  return (
    <div className="share" style={{ padding: mobile ? "8px 16px 24px" : "16px 18px 14px" }}>
      {!mobile && <h2 className="share-h">{t("Compartilhar")}</h2>}
      <div className="share-row">
        <span className={`share-ico${shared ? " on" : ""}`} aria-hidden="true"><IconGlobe /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div id="share-public-label" style={{ fontWeight: 600 }}>{t("Link público")}</div>
          <div className="share-status" aria-live="polite">{status}</div>
        </div>
        <button type="button" className={`switch${shared ? " on" : ""}`} role="switch" aria-checked={shared}
          aria-labelledby="share-public-label" disabled={busy || archived || !share.data || share.loading || !!share.error} aria-busy={busy}
          onClick={() => void toggle()} />
      </div>

      {!archived && !!share.error && !share.loading && (
        <button type="button" className="btn" onClick={() => void share.reload()}>{t("Tentar de novo")}</button>
      )}

      {shared && (
        <div className="share-link">
          <div className="share-copy">
            <label htmlFor="share-url" className="sr-only">{t("Link do projeto")}</label>
            <input ref={field} id="share-url" className="input share-url" readOnly value={url}
              onFocus={(event) => event.currentTarget.select()} />
            {!mobile && <CopyButton copied={copied} onClick={() => void copy()} />}
          </div>
          {mobile ? (
            <div className="share-actions">
              {canNativeShare && (
                <button type="button" className="btn lg" onClick={() => void navigator.share({ url }).catch(() => undefined)}>
                  <IconShare />{t("Enviar…")}</button>
              )}
              <CopyButton copied={copied} onClick={() => void copy()} large />
            </div>
          ) : null}
          {openPublicPage ? (
            <button type="button" className="share-open" onClick={() => {
              void openPublicPage(token).then(onClose, () => toast(t("Não foi possível abrir a página pública no navegador."), { bad: true }));
            }}>
              {t("Abrir página pública")}<IconExternal />
            </button>
          ) : !mobile && (
            <a className="share-open" href={publicProjectPath(token)} target="_blank" rel="noopener noreferrer" onClick={onClose}>
              {t("Abrir página pública")}<IconExternal />
            </a>
          )}
        </div>
      )}

      <div className="msep" style={{ margin: mobile ? "0 -16px" : "0 -18px" }} />
      <ul className="share-notes">
        <li><IconEye />{t("Só leitura: quem abre vê seções, tarefas, descrições e etiquetas, sem entrar na sua conta.")}</li>
        <li><IconLink />{t("Desativar invalida o link na hora. Ao ativar de novo, um link novo é gerado. Arquivar o projeto também desativa.")}</li>
      </ul>
    </div>
  );
}

function CopyButton({ copied, onClick, large }: { copied: boolean; onClick: () => void; large?: boolean }) {
  const t = useT();
  return (
    <button type="button" className={`btn share-copy-btn${large ? " lg" : ""}${copied ? " copied" : " primary"}`} onClick={onClick}>
      {copied ? <IconCheck /> : <IconDuplicate />}
      <span aria-live="polite">{copied ? t("Copiado") : t("Copiar link")}</span>
    </button>
  );
}

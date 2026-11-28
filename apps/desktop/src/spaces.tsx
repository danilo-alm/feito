import { translateMessage, translate as t } from "@feito/ui/client/locale";
import { useT } from "@feito/ui/components/language";
import { useState, type FormEvent } from "react";
import { desktop } from "./data/native";
import type { DesktopStatus } from "./data/desktop";
import { IconChevronRight, IconEdit, IconGlobe, IconLogout, IconMonitor, IconPause, IconPlay, IconPlus, IconRepeat, IconTrash } from "@feito/ui/components/icons";
import { SettingsGroup, SettingsLinkRow, SettingsRow } from "@feito/ui/components/settings";
import { Dialog } from "@feito/ui/components/ui";

function syncLabel(status: DesktopStatus) {
  const count = status.server?.pending ?? 0;
  if (status.server?.syncPaused) return t("Sincronização pausada");
  if (status.sync === "login") return t("Entre para sincronizar");
  if (status.sync === "offline") return count ? t("Sem conexão · {0} na fila", [count]) : t("Sem conexão com o servidor");
  if (status.sync === "syncing") return t("Sincronizando…");
  if (status.sync === "error") return t("Sincronização interrompida");
  return status.sync === "current" ? t("Sincronizado") : t("Somente neste computador");
}

type Confirm = (options: { title: string; body: string; confirmLabel: string; danger: true }) => Promise<boolean>;

export function SpaceManager({ status, confirm }: { status: DesktopStatus; confirm?: Confirm }) {
  const t = useT();
  const [origin, setOrigin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingOrigin, setEditingOrigin] = useState<string>();
  const [error, setError] = useState<string>();

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : typeof failure === "string" ? failure : t("Não foi possível concluir a ação."));
    } finally {
      setBusy(false);
    }
  };

  const openForm = (server?: DesktopStatus["server"]) => {
    setEditingOrigin(server?.origin);
    setOrigin(server?.origin ?? "");
    setEmail(server?.email ?? "");
    setPassword("");
    setError(undefined);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingOrigin(undefined);
    setPassword("");
    setError(undefined);
  };

  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const submittedPassword = password;
    setPassword("");
    void perform(async () => {
      if (editingOrigin) await desktop.updateConnection(editingOrigin, origin, email, submittedPassword);
      else await desktop.connect(origin, email, submittedPassword);
      closeForm();
    });
  };

  const deleteLocal = () => void perform(async () => {
    if (await confirm?.({
      title: t("Excluir o espaço local?"),
      body: t("Todas as tarefas, projetos e etiquetas deste espaço serão excluídos permanentemente deste computador."),
      confirmLabel: t("Excluir espaço local"),
      danger: true,
    })) await desktop.deleteLocal();
  });

  const discardRejected = (id: string) => void perform(async () => {
    if (await confirm?.({
      title: t("Descartar a alteração rejeitada?"),
      body: t("O Feito vai restaurar o valor do servidor e continuar com as próximas alterações da fila."),
      confirmLabel: t("Descartar alteração"),
      danger: true,
    })) await desktop.discardRejected(id);
  });

  const host = (origin: string) => origin.replace(/^https:\/\//, "");

  return (
    <SettingsGroup id="espacos" title={t("Espaços de trabalho")}>
      <div className="set-card">
        <SettingsRow icon={<IconMonitor />} tone={status.active === "local" ? "brand" : undefined}
          label={<>{t("Espaço local")}{status.active === "local" && <span className="set-pill">{t("Em uso")}</span>}</>}
          hint={status.hasLocal ? t("Tarefas guardadas somente neste computador.") : t("Nenhum espaço local criado.")}
          control={!status.hasLocal ? (
            <button className="btn" type="button" disabled={busy} onClick={() => void perform(desktop.createLocal)}>{t("Criar espaço local")}</button>
          ) : status.active !== "local" && (
            <button className="btn" type="button" disabled={busy} onClick={() => void perform(() => desktop.switchSpace("local"))}>{t("Abrir")}</button>
          )} />
        {status.servers.map((server) => {
          const active = status.active === "server" && status.server?.origin === server.origin;
          const summary = active ? syncLabel(status) : server.syncPaused ? t("Sincronização pausada") : "";
          const queued = server.pending > 0 && (!active || server.syncPaused || status.sync !== "offline")
            ? t(" · {0} na fila", [server.pending]) : "";
          const pauseLabel = server.syncPaused ? t("Retomar sincronização") : t("Pausar sincronização");
          return (
            <SettingsRow key={server.origin} icon={<IconGlobe />} tone={active ? "brand" : undefined}
              label={<>{host(server.origin)}{active && <span className="set-pill">{t("Em uso")}</span>}</>}
              hint={<>{server.email}<span role="status">{summary ? ` · ${summary}` : ""}{queued}</span></>}
              control={<>
                <button className="icon-btn" type="button" disabled={busy} aria-label={t("Editar conexão")} data-tooltip={t("Editar conexão")}
                  onClick={() => openForm(server)}><IconEdit /></button>
                <button className="icon-btn" type="button" aria-disabled={busy} aria-label={pauseLabel} data-tooltip={pauseLabel}
                  onClick={() => { if (!busy) void perform(() => desktop.setSyncPaused(server.origin, !server.syncPaused)); }}>
                  {server.syncPaused ? <IconPlay /> : <IconPause />}
                </button>
                {!active ? (
                  <button className="btn" type="button" disabled={busy}
                    onClick={() => void perform(() => desktop.openServer(server.origin))}>{t("Abrir")}</button>
                ) : status.sync === "login" ? (
                  <button className="btn" type="button" disabled={busy} onClick={() => openForm(server)}>{t("Entrar novamente")}</button>
                ) : <>
                  {!server.syncPaused && (
                    <button className="icon-btn" type="button" disabled={busy || status.sync === "syncing"}
                      aria-label={t("Sincronizar agora")} data-tooltip={t("Sincronizar agora")}
                      onClick={() => void perform(desktop.sync)}><IconRepeat /></button>
                  )}
                  <button className="icon-btn" type="button" disabled={busy} aria-label={t("Encerrar sessão")} data-tooltip={t("Encerrar sessão")}
                    onClick={() => void perform(desktop.signOut)}><IconLogout /></button>
                </>}
              </>}
              extra={active && (status.blocked || (status.error && status.sync !== "login") || server.notice) && (
                <div className="set-status">
                  {status.error && status.sync !== "login" && <span>{status.error && translateMessage(status.error)}</span>}
                  {server.notice && <span role="status">{server.notice && translateMessage(server.notice)}</span>}
                  {status.blocked && <div><button className="btn ghost danger" type="button" disabled={busy}
                    onClick={() => discardRejected(status.blocked!)}>{t("Descartar alteração rejeitada")}</button></div>}
                </div>
              )} />
          );
        })}
        <SettingsLinkRow onClick={() => { if (!busy) openForm(); }} tone="brand" icon={<IconPlus />}
          label={status.servers.length ? t("Conectar outro servidor") : t("Conectar a um servidor")}
          hint={t("Sincronize com uma instalação do Feito por HTTPS.")}
          trailing={<IconChevronRight className="set-chev" />} />
        <Dialog open={showForm} onClose={() => { if (!busy) closeForm(); }} title={editingOrigin ? t("Editar conexão") : t("Conectar a um servidor")} width={440}>
          <form className="dialog-b connection-form" onSubmit={connect} aria-label={editingOrigin ? t("Editar conexão") : t("Conectar a um servidor")}>
            <fieldset disabled={busy} className="connection-fields">
              <label className="ps-field">
                <span className="lbl">{t("Endereço HTTPS do Feito")}</span>
                <input className="inline-input" type="url" value={origin} placeholder={t("https://feito.exemplo.com")} autoComplete="url"
                  required data-autofocus onChange={(event) => setOrigin(event.target.value)} />
              </label>
              <div className="connection-fields">
                <label className="ps-field">
                  <span className="lbl">{t("E-mail")}</span>
                  <input className="inline-input" type="email" value={email} autoComplete="username" required onChange={(event) => setEmail(event.target.value)} />
                </label>
                <label className="ps-field">
                  <span className="lbl">{t("Senha")}</span>
                  <input className="inline-input" type="password" value={password} autoComplete="current-password" required onChange={(event) => setPassword(event.target.value)} />
                </label>
              </div>
            </fieldset>
            <div className="named-details-actions">
              <button className="btn primary" type="submit" disabled={busy}>{busy ? t("Conectando…") : editingOrigin ? t("Salvar conexão") : t("Conectar")}</button>
              <button className="btn ghost" type="button" disabled={busy} onClick={closeForm}>{t("Cancelar")}</button>
            </div>
            {error && <p className="field-error" role="alert">{translateMessage(error)}</p>}
          </form>
        </Dialog>
      </div>
      {status.hasLocal && confirm && (
        <div className="set-card">
          <SettingsRow icon={<IconTrash />} tone="danger" label={t("Excluir espaço local")}
            hint={t("Apaga para sempre as tarefas, projetos e etiquetas deste computador. Espaços remotos continuam.")}
            control={<button className="btn ghost danger" type="button" disabled={busy} onClick={deleteLocal}>{t("Excluir…")}</button>} />
        </div>
      )}
      {error && !showForm && <p className="field-error" role="alert">{translateMessage(error)}</p>}
    </SettingsGroup>
  );
}

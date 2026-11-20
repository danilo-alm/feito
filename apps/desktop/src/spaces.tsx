import { useState, type FormEvent } from "react";
import { desktop } from "./data/native";
import type { DesktopStatus } from "./data/desktop";
import { IconChevronDown, IconChevronRight, IconGlobe, IconMonitor, IconPlus, IconTrash } from "@feito/ui/components/icons";
import { SettingsGroup, SettingsLinkRow, SettingsRow } from "@feito/ui/components/settings";

export function syncLabel(status: DesktopStatus) {
  const count = status.server?.pending ?? 0;
  if (status.sync === "login") return "Entre para sincronizar";
  if (status.sync === "offline") return count ? `Sem conexão · ${count} na fila` : "Sem conexão com o servidor";
  if (status.sync === "syncing") return "Sincronizando…";
  if (status.sync === "error") return "Sincronização interrompida";
  return status.sync === "current" ? "Sincronizado" : "Somente neste computador";
}

type Confirm = (options: { title: string; body: string; confirmLabel: string; danger: true }) => Promise<boolean>;

export function SpaceManager({ status, confirm }: { status: DesktopStatus; confirm?: Confirm }) {
  const [origin, setOrigin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string>();

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "Não foi possível concluir a ação.");
    } finally {
      setBusy(false);
    }
  };

  const openForm = (server?: DesktopStatus["server"]) => {
    setOrigin(server?.origin ?? "");
    setEmail(server?.email ?? "");
    setPassword("");
    setError(undefined);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setPassword("");
    setError(undefined);
  };

  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedPassword = password;
    setPassword("");
    void perform(async () => {
      await desktop.connect(origin, email, submittedPassword);
      setShowForm(false);
    });
  };

  const deleteLocal = () => void perform(async () => {
    if (await confirm?.({
      title: "Excluir o espaço local?",
      body: "Todas as tarefas, projetos e etiquetas deste espaço serão excluídos permanentemente deste computador.",
      confirmLabel: "Excluir espaço local",
      danger: true,
    })) await desktop.deleteLocal();
  });

  const discardRejected = (id: string) => void perform(async () => {
    if (await confirm?.({
      title: "Descartar a alteração rejeitada?",
      body: "O Feito vai restaurar o valor do servidor e continuar com as próximas alterações da fila.",
      confirmLabel: "Descartar alteração",
      danger: true,
    })) await desktop.discardRejected(id);
  });


  const host = (origin: string) => origin.replace(/^https:\/\//, "");

  return (
    <SettingsGroup id="espacos" title="Espaços de trabalho">
      <div className="set-card">
        <SettingsRow icon={<IconMonitor />} tone={status.active === "local" ? "brand" : undefined}
          label={<>Espaço local{status.active === "local" && <span className="set-pill">Em uso</span>}</>}
          hint={status.hasLocal ? "Tarefas guardadas somente neste computador." : "Nenhum espaço local criado."}
          control={!status.hasLocal ? (
            <button className="btn" type="button" disabled={busy} onClick={() => void perform(desktop.createLocal)}>Criar espaço local</button>
          ) : status.active !== "local" && (
            <button className="btn" type="button" disabled={busy} onClick={() => void perform(() => desktop.switchSpace("local"))}>Abrir</button>
          )} />
        {status.servers.map((server) => {
          const active = status.active === "server" && status.server?.origin === server.origin;
          const queued = server.pending > 0 ? ` · ${server.pending} na fila` : "";
          return active ? (
            <SettingsRow key={server.origin} icon={<IconGlobe />} tone="brand"
              label={<>{host(server.origin)}<span className="set-pill">Em uso</span></>}
              hint={<>{server.email} · <span role="status">{syncLabel(status)}{status.sync !== "offline" ? queued : ""}</span></>}
              control={status.sync === "login" ? (
                <button className="btn" type="button" disabled={busy} onClick={() => openForm(server)}>Entrar novamente</button>
              ) : <>
                <button className="btn" type="button" disabled={busy || status.sync === "syncing"}
                  onClick={() => void perform(desktop.sync)}>Sincronizar agora</button>
                <button className="btn ghost" type="button" disabled={busy} onClick={() => void perform(desktop.signOut)}>Encerrar sessão</button>
              </>}
              extra={(status.blocked || (status.error && status.sync !== "login") || server.notice) && (
                <div className="set-status">
                  {status.error && status.sync !== "login" && <span>{status.error}</span>}
                  {server.notice && <span role="status">{server.notice}</span>}
                  {status.blocked && <div><button className="btn ghost danger" type="button" disabled={busy}
                    onClick={() => discardRejected(status.blocked!)}>Descartar alteração rejeitada</button></div>}
                </div>
              )} />
          ) : (
            <SettingsRow key={server.origin} icon={<IconGlobe />} label={host(server.origin)} hint={`${server.email}${queued}`}
              control={<button className="btn" type="button" disabled={busy}
                onClick={() => void perform(() => desktop.openServer(server.origin))}>Abrir</button>} />
          );
        })}
        <SettingsLinkRow onClick={() => (showForm ? closeForm() : openForm())} tone="brand" icon={<IconPlus />}
          label={status.servers.length ? "Conectar outro servidor" : "Conectar a um servidor"}
          hint="Sincronize com uma instalação do Feito por HTTPS."
          trailing={showForm ? <IconChevronDown className="set-chev" /> : <IconChevronRight className="set-chev" />} />
        {showForm && (
          <form className="set-form" onSubmit={connect} aria-label="Conectar a um servidor">
            <label className="field">
              <strong>Endereço HTTPS do Feito</strong>
              <input className="input" type="url" value={origin} placeholder="https://feito.exemplo.com" autoComplete="url"
                required autoFocus onChange={(event) => setOrigin(event.target.value)} />
            </label>
            <div className="set-form-pair">
              <label className="field">
                <strong>E-mail</strong>
                <input className="input" type="email" value={email} autoComplete="username" required onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="field">
                <strong>Senha</strong>
                <input className="input" type="password" value={password} autoComplete="current-password" required onChange={(event) => setPassword(event.target.value)} />
              </label>
            </div>
            <div className="desktop-inline">
              <button className="btn primary" type="submit" disabled={busy}>{busy ? "Conectando…" : "Conectar"}</button>
              <button className="btn ghost" type="button" disabled={busy} onClick={closeForm}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
      {status.hasLocal && confirm && (
        <div className="set-card">
          <SettingsRow icon={<IconTrash />} tone="danger" label="Excluir espaço local"
            hint="Apaga para sempre as tarefas, projetos e etiquetas deste computador. Espaços remotos continuam."
            control={<button className="btn ghost danger" type="button" disabled={busy} onClick={deleteLocal}>Excluir…</button>} />
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </SettingsGroup>
  );
}

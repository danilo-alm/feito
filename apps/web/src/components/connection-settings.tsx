"use client";

import { translate as t } from "@feito/ui/client/locale";
import { useT } from "@feito/ui/components/language";

import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@feito/ui/client/api";
import { IconEdit } from "@feito/ui/components/icons";
import { Dialog } from "@feito/ui/components/ui";
import { browserRouter } from "@/browser/navigation";
import { workspace } from "@/browser/client";

function connectionOrigin(input: string) {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error(t("Informe o endereço HTTPS da instalação, sem caminho nem parâmetros."));
  }
  return url.origin;
}

export function ConnectionSettings({ email }: { email: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  let otherServer = true;
  try { otherServer = connectionOrigin(origin) !== window.location.origin; } catch { /* Validado ao salvar. */ }
  const close = () => { if (!busy) { setOpen(false); setPassword(""); } };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const submittedPassword = password;
    setPassword("");
    try {
      let address: string;
      try { address = connectionOrigin(origin); }
      catch { throw new Error(t("Informe o endereço HTTPS da instalação, sem caminho nem parâmetros.")); }
      if (address !== window.location.origin) {
        window.location.assign(new URL("/entrar?voltar=%2Fajustes", address).href);
        return;
      }
      const status = workspace.getStatus();
      if (status.pending && username.trim().toLowerCase() !== email.toLowerCase()) {
        throw new Error(t("Sincronize as alterações pendentes antes de trocar a conta."));
      }
      const session = await api.auth.login(username.trim(), submittedPassword);
      setOpen(false);
      if (session.mustChangePassword) browserRouter.replace("/trocar-senha");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <button type="button" className="icon-btn" aria-label={t("Editar conexão")} data-tooltip={t("Editar conexão")}
      onClick={() => { setOrigin(window.location.origin); setUsername(email); setPassword(""); setError(undefined); setOpen(true); }}><IconEdit /></button>
    <Dialog open={open} onClose={close} title={t("Editar conexão")} width={440}>
      <form className="dialog-b connection-form" onSubmit={submit}>
        <label className="ps-field"><span className="lbl">{t("Endereço HTTPS do Feito")}</span>
          <input className="inline-input" type="url" required data-autofocus autoComplete="url" value={origin} disabled={busy}
            onChange={(event) => setOrigin(event.target.value)} /></label>
        {otherServer ? <p className="hint">{t("Ao trocar o endereço, o Feito abre o outro servidor para você entrar lá. A cópia e a fila desta conta continuam neste navegador.")}</p> : <>
          <label className="ps-field"><span className="lbl">{t("E-mail")}</span>
            <input className="inline-input" type="email" required autoComplete="username" value={username} disabled={busy}
              onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="ps-field"><span className="lbl">{t("Senha")}</span>
            <input className="inline-input" type="password" required autoComplete="current-password" value={password} disabled={busy}
              onChange={(event) => setPassword(event.target.value)} /></label>
        </>}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="named-details-actions">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? t("Conectando…") : otherServer ? t("Abrir servidor") : t("Salvar conexão")}</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={close}>{t("Cancelar")}</button>
        </div>
      </form>
    </Dialog>
  </>;
}

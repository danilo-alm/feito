"use client";

import { useT } from "@feito/ui/components/language";

import { useRef, useState, type ReactNode } from "react";
import { api, ApiFailure, errorMessage } from "@feito/ui/client/api";
import { Logo } from "@feito/ui/components/icons";
import { Dialog } from "@feito/ui/components/ui";
import { BrowserLink as Link, browserRouter, safeNext, useBrowserRoute } from "@/browser/navigation";
import { persistBrowserData, useBrowserStatus, workspace } from "@/browser/client";
import { discardMessage } from "./sync-labels";

function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <main id="conteudo" style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
          <Logo size={48} />
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.015em" }}>{title}</h1>
          <p className="sub" style={{ fontSize: 14 }}>{subtitle}</p>
        </div>
        {children}
        {footer && <p className="hint" style={{ textAlign: "center", lineHeight: 1.5 }}>{footer}</p>}
      </main>
    </div>
  );
}

export function LoginForm() {
  const t = useT();
  const route = useBrowserRoute();
  const status = useBrowserStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openLocal = async () => {
    setBusy(true);
    setError(null);
    try {
      persistBrowserData();
      await workspace.openLocal();
      browserRouter.replace(safeNext(route));
    } catch {
      setError(t("Não foi possível abrir o espaço neste navegador. Verifique o armazenamento e tente de novo."));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.auth.login(email.trim(), password);
      persistBrowserData();
      browserRouter.replace(session.mustChangePassword ? "/trocar-senha" : safeNext(route));
    } catch (failure) {
      setPassword("");
      if (failure instanceof ApiFailure && failure.code === "RATE_LIMITED") {
        setError(t("Muitas tentativas. Aguarde alguns minutos e tente de novo."));
      } else if (failure instanceof ApiFailure && failure.code === "INVALID_CREDENTIALS") {
        setError("E-mail ou senha incorretos.");
      } else {
        setError(errorMessage(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={t("Entrar no Feito")} subtitle={t("Suas tarefas, nesta instalação.")}
      footer={t("Sem cadastro público. Quem administra esta instalação cria contas e ajuda a recuperar o acesso.")}>
      <form className="panel" style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }} onSubmit={submit} noValidate>
        {error && <div className="banner error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">{t("E-mail")}</label>
          <input id="email" className="input" type="email" autoComplete="username" required autoFocus
            value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">{t("Senha")}</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required
            value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="password-hint" />
          <span id="password-hint" className="hint">{t("Senha com 5 a 128 caracteres.")}</span>
        </div>
        <button type="submit" className="btn primary lg" style={{ justifyContent: "center", width: "100%" }}
          disabled={busy || !email.trim() || !password}>
          {busy ? t("Entrando…") : t("Entrar")}
        </button>
      </form>
      <button type="button" className="btn" disabled={busy} style={{ justifyContent: "center" }}
        onClick={() => void openLocal()}>{t("Usar neste navegador, sem conta")}</button>
      {status.loaded && <Link href={safeNext(route)} className="text-btn" style={{ alignSelf: "center" }}>
        {status.space.kind === "account" ? t("Voltar à cópia neste navegador") : t("Voltar ao espaço sem conta")}
      </Link>}
    </AuthFrame>
  );
}

export function ChangePasswordForm() {
  const t = useT();
  const status = useBrowserStatus();
  const provisional = status.provisional;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pending, setPending] = useState(0);
  const cancel = useRef<HTMLButtonElement>(null);

  const length = [...next].length;
  const tooShort = next.length > 0 && length < 5;
  const tooLong = length > 128;
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || tooShort || tooLong || mismatch || !current || !next) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.changePassword(current, next);
      browserRouter.replace("/hoje");
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "INVALID_CREDENTIALS") setError(t("A senha atual não confere."));
      else setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const logout = async (confirmed = false) => {
    try {
      const { pending } = await workspace.logout(confirmed, status.epoch);
      if (pending) setPending(pending);
      else browserRouter.replace("/entrar");
    } catch {
      setError(t("Não foi possível apagar os dados da conta neste navegador. Tente de novo."));
    }
  };

  return (
    <AuthFrame
      title={provisional ? t("Defina sua senha") : t("Trocar senha")}
      subtitle={provisional ? t("Você entrou com uma senha provisória. Escolha uma nova para continuar.") : t("As outras sessões abertas serão encerradas.")}
      footer={provisional ? <button type="button" className="text-btn" onClick={() => void logout()}>{t("Sair")}</button> : <Link href="/ajustes" className="text-btn">{t("Voltar aos ajustes")}</Link>}
    >
      <form className="panel" style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }} onSubmit={submit} noValidate>
        {error && <div className="banner error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="current">{provisional ? t("Senha provisória") : t("Senha atual")}</label>
          <input id="current" className="input" type="password" autoComplete="current-password" autoFocus
            value={current} onChange={(event) => setCurrent(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new">{t("Nova senha")}</label>
          <input id="new" className="input" type="password" autoComplete="new-password" aria-describedby="new-hint"
            aria-invalid={tooShort || tooLong} value={next} onChange={(event) => setNext(event.target.value)} />
          <span id="new-hint" className={tooShort || tooLong ? "field-error" : "hint"}>
            {tooLong ? t("Use no máximo 128 caracteres.") : t("Senha com 5 a 128 caracteres{0}.", [next ? ` · ${length}` : ""])}
          </span>
        </div>
        <div className="field">
          <label htmlFor="confirm">{t("Repita a nova senha")}</label>
          <input id="confirm" className="input" type="password" autoComplete="new-password" aria-invalid={mismatch}
            aria-describedby={mismatch ? "confirm-error" : undefined} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          {mismatch && <span id="confirm-error" className="field-error">{t("As senhas não conferem.")}</span>}
        </div>
        <button type="submit" className="btn primary lg" style={{ justifyContent: "center", width: "100%" }}
          disabled={busy || !current || length < 5 || tooLong || confirm !== next}>
          {busy ? t("Salvando…") : t("Salvar nova senha")}
        </button>
      </form>
      <Dialog open={pending > 0} onClose={() => setPending(0)} title={t("Sair e descartar alterações?")} initialFocus={cancel}
        footer={<>
          <button ref={cancel} type="button" className="btn ghost" onClick={() => setPending(0)}>{t("Cancelar")}</button>
          <button type="button" className="btn danger" onClick={() => void logout(true)}>{t("Sair e descartar")}</button>
        </>}>
        <div className="dialog-b">{discardMessage(pending)}</div>
      </Dialog>
    </AuthFrame>
  );
}

"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiFailure, errorMessage } from "@feito/ui/client/api";
import { clearCache } from "@feito/ui/client/store";
import { Logo } from "@feito/ui/components/icons";

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

function safeNext(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/hoje";
  try {
    const target = new URL(value, window.location.href);
    if (target.origin === window.location.origin && !target.pathname.startsWith("/entrar")) return value;
  } catch {
    // Uma URL inválida cai no destino padrão.
  }
  return "/hoje";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Sessão ainda válida: segue direto para o app.
    api.auth.session().then((session) => {
      router.replace(session.mustChangePassword ? "/trocar-senha" : safeNext(params.get("voltar")));
    }, () => undefined);
  }, [router, params]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.auth.login(email.trim(), password);
      clearCache();
      router.replace(session.mustChangePassword ? "/trocar-senha" : safeNext(params.get("voltar")));
    } catch (failure) {
      setPassword("");
      if (failure instanceof ApiFailure && failure.code === "RATE_LIMITED") {
        setError("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
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
    <AuthFrame title="Entrar no Feito" subtitle="Suas tarefas, nesta instalação."
      footer="Sem cadastro público. Quem administra esta instalação cria contas e ajuda a recuperar o acesso.">
      <form className="panel" style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }} onSubmit={submit} noValidate>
        {error && <div className="banner error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="input" type="email" autoComplete="username" required autoFocus
            value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required
            value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="password-hint" />
          <span id="password-hint" className="hint">Senha com 5 a 128 caracteres.</span>
        </div>
        <button type="submit" className="btn primary lg" style={{ justifyContent: "center", width: "100%" }}
          disabled={busy || !email.trim() || !password}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </AuthFrame>
  );
}

export function ChangePasswordForm() {
  const router = useRouter();
  const [provisional, setProvisional] = useState<boolean | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.auth.session().then((session) => setProvisional(session.mustChangePassword), () => router.replace("/entrar"));
  }, [router]);

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
      clearCache();
      router.replace("/hoje");
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "INVALID_CREDENTIALS") setError("A senha atual não confere.");
      else setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api.auth.logout().catch(() => undefined);
    clearCache();
    router.replace("/entrar");
  };

  return (
    <AuthFrame
      title={provisional ? "Defina sua senha" : "Trocar senha"}
      subtitle={provisional ? "Você entrou com uma senha provisória. Escolha uma nova para continuar." : "As outras sessões abertas serão encerradas."}
      footer={provisional ? <button type="button" className="text-btn" onClick={logout}>Sair</button> : <Link href="/ajustes" className="text-btn">Voltar aos ajustes</Link>}
    >
      <form className="panel" style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }} onSubmit={submit} noValidate>
        {error && <div className="banner error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="current">{provisional ? "Senha provisória" : "Senha atual"}</label>
          <input id="current" className="input" type="password" autoComplete="current-password" autoFocus
            value={current} onChange={(event) => setCurrent(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new">Nova senha</label>
          <input id="new" className="input" type="password" autoComplete="new-password" aria-describedby="new-hint"
            aria-invalid={tooShort || tooLong} value={next} onChange={(event) => setNext(event.target.value)} />
          <span id="new-hint" className={tooShort || tooLong ? "field-error" : "hint"}>
            {tooLong ? "Use no máximo 128 caracteres." : `Senha com 5 a 128 caracteres${next ? ` · ${length}` : ""}.`}
          </span>
        </div>
        <div className="field">
          <label htmlFor="confirm">Repita a nova senha</label>
          <input id="confirm" className="input" type="password" autoComplete="new-password" aria-invalid={mismatch}
            aria-describedby={mismatch ? "confirm-error" : undefined} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          {mismatch && <span id="confirm-error" className="field-error">As senhas não conferem.</span>}
        </div>
        <button type="submit" className="btn primary lg" style={{ justifyContent: "center", width: "100%" }}
          disabled={busy || !current || length < 5 || tooLong || confirm !== next}>
          {busy ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>
    </AuthFrame>
  );
}

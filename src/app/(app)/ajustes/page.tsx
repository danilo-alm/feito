"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { api, ApiFailure, errorMessage } from "@/client/api";
import { clearCache, setQueryData, useQuery } from "@/client/store";
import type { ImportPreview, ImportResult, Me, ProjectSummary, Theme } from "@/client/types";
import { applyTheme, useApp } from "@/components/app";
import { PageHeader } from "@/components/chrome";
import { IconAlert, IconDownload, IconHash, IconMonitor, IconMoon, IconSun, IconUpload } from "@/components/icons";
import { useToast } from "@/components/ui";

const THEMES: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Claro", icon: <IconSun /> },
  { value: "dark", label: "Escuro", icon: <IconMoon /> },
  { value: "system", label: "Sistema", icon: <IconMonitor /> },
];

function countsText(counts: NonNullable<ImportPreview["counts"]>) {
  return `${counts.projects} projetos · ${counts.archivedProjects} arquivados · ${counts.sections} seções · ${counts.tasks} tarefas`
    + ` (${counts.completedTasks} concluídas) · ${counts.labels} etiquetas · ${counts.occurrences} ocorrências`;
}

export default function SettingsPage() {
  const app = useApp();
  const toast = useToast();
  const router = useRouter();
  const archived = useQuery<{ projects: ProjectSummary[] }>("archived", () => api.projects.list("archived"));
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [app.timezone];
    }
  }, [app.timezone]);

  const savePreferences = async (patch: { theme?: Theme; timezone?: string }) => {
    if (patch.theme) applyTheme(patch.theme);
    const saved = await app.run(() => api.preferences(patch), { success: patch.timezone ? "Fuso horário atualizado" : undefined });
    if (saved) setQueryData<Me>("me", (me) => me && { ...me, preferences: saved });
  };

  const logout = async () => {
    await api.auth.logout().catch(() => undefined);
    clearCache();
    router.replace("/entrar");
  };

  return (
    <>
      <PageHeader crumb="Conta e preferências" mobileTitle="Ajustes" />
      <div className="content">
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="page-h"><h1 className="title">Ajustes</h1></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-labelledby="aparencia">
                <h2 id="aparencia" style={{ fontSize: 15, fontWeight: 700 }}>Aparência</h2>
                <div className="seg" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }} role="radiogroup" aria-label="Tema">
                  {THEMES.map((theme) => (
                    <button key={theme.value} type="button" role="radio" aria-checked={app.me.preferences.theme === theme.value}
                      className={`seg-o${app.me.preferences.theme === theme.value ? " on" : ""}`} style={{ minHeight: 56 }}
                      onClick={() => void savePreferences({ theme: theme.value })}>
                      {theme.icon}{theme.label}
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 4 }} aria-labelledby="agenda">
                <h2 id="agenda" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Agenda</h2>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 180px" }}>
                    <label htmlFor="tz">Fuso horário do perfil</label>
                    <div className="hint">Define o que é “Hoje” e quando uma tarefa fica atrasada.</div>
                  </div>
                  <select id="tz" className="select" value={app.timezone} onChange={(event) => void savePreferences({ timezone: event.target.value })}>
                    {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                  </select>
                </div>
              </section>
              <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 4 }} aria-labelledby="conta">
                <h2 id="conta" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Conta</h2>
                <div className="row"><div><div>E-mail de acesso</div><div className="hint">{app.me.user.email}</div></div></div>
                <div className="row"><span>Senha</span><Link className="btn" href="/trocar-senha">Trocar senha</Link></div>
                <div className="row"><span>Sessão</span><button type="button" className="btn ghost danger" onClick={() => void logout()}>Sair</button></div>
                <div className="hint">Esqueceu a senha? Quem administra esta instalação pode redefini-la.</div>
              </section>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <section id="arquivados" className="panel" style={{ display: "flex", flexDirection: "column", gap: 4, scrollMarginTop: 24 }} aria-labelledby="arq-h">
                <h2 id="arq-h" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Projetos arquivados</h2>
                {!archived.data?.projects.length && <p className="hint">Nenhum projeto arquivado.</p>}
                {archived.data?.projects.map((project, index, list) => (
                  <div key={project.id} className="row" style={{ borderBottom: index < list.length - 1 ? "1px solid var(--border)" : undefined }}>
                    <Link href={`/projetos/${project.id}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <IconHash style={{ color: "var(--muted)" }} />{project.name}
                    </Link>
                    <button type="button" className="btn" onClick={() => void app.run(() => api.projects.unarchive(project.id, project.revision), { success: `“${project.name}” reativado` })}>
                      Reativar
                    </button>
                  </div>
                ))}
              </section>
              <DataPanel onToast={toast} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function DataPanel({ onToast }: { onToast: ReturnType<typeof useToast> }) {
  const app = useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    const id = crypto.randomUUID();
    setFile(picked);
    setPreview(null);
    setResult(null);
    setFailure(null);
    setOperationId(id);
    setBusy(true);
    try {
      setPreview(await api.portability.preview(picked, id));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "IMPORT_INVALID") {
        setPreview({ schemaVersion: null, counts: null, errors: (error.details?.errors as ImportPreview["errors"]) ?? [], destinationEmpty: false, previewToken: null, expiresAt: null });
      } else {
        setFailure(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!file || !preview?.previewToken || !operationId) return;
    const ok = await app.confirm({
      title: "Importar este arquivo?",
      body: "Os dados serão restaurados nesta conta. A operação é atômica: se algo falhar, nada muda.",
      confirmLabel: "Importar",
    });
    if (!ok) return;
    setBusy(true);
    setFailure(null);
    try {
      setResult(await api.portability.confirm(file, preview.previewToken, operationId));
      onToast("Importação concluída");
      void app.refresh();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "NETWORK_ERROR") {
        setFailure("A conexão caiu durante a importação. Verifique o resultado antes de tentar de novo.");
      } else {
        setFailure(error instanceof ApiFailure && error.code === "PREVIEW_EXPIRED" ? "A prévia expirou. Escolha o arquivo de novo." : errorMessage(error));
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

  return (
    <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-labelledby="dados">
      <h2 id="dados" style={{ fontSize: 15, fontWeight: 700 }}>Seus dados</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <IconDownload style={{ color: "var(--brand-text)", marginTop: 2 }} />
        <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontWeight: 600 }}>Exportar tudo</div>
          <div className="hint">Projetos ativos e arquivados, seções, tarefas abertas e concluídas, subtarefas, etiquetas, recorrências e preferências em um arquivo JSON versionado. O arquivo fica legível: guarde em local privado.</div>
        </div>
        <a className="btn primary" href={api.portability.exportUrl()} download>Exportar</a>
      </div>
      <div className="msep" style={{ margin: 0 }} />
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <IconUpload style={{ color: "var(--brand-text)", marginTop: 2 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>Importar um arquivo</div>
          <div className="hint">A restauração só acontece numa conta vazia, com apenas a Caixa de entrada inicial.</div>
          <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" id="import-file"
            onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
          {(preview || failure || result) && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "var(--sunken)", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }} role="status">
              {file && <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{file.name}</div>}
              {result ? (
                <div style={{ color: "var(--brand-text)", fontWeight: 600 }}>Restaurado: {countsText(result.summary)}</div>
              ) : preview && (
                <>
                  {preview.counts && <div className="sub">Versão {preview.schemaVersion} · {countsText(preview.counts)} · {preview.errors.length} erros</div>}
                  {preview.errors.slice(0, 6).map((item) => (
                    <div key={item.path + item.message} className="field-error"><code>{item.path || "arquivo"}</code>: {item.message}</div>
                  ))}
                  {preview.errors.length > 6 && <div className="field-error">e mais {preview.errors.length - 6} erros.</div>}
                  {!preview.errors.length && !preview.destinationEmpty && (
                    <div style={{ display: "flex", gap: 8, color: "var(--late)", fontWeight: 600, alignItems: "flex-start" }}>
                      <IconAlert className="sm" style={{ marginTop: 2 }} />
                      Esta conta já tem dados. A importação restaura apenas em uma conta vazia, com só a Caixa de entrada inicial.
                    </div>
                  )}
                </>
              )}
              {failure && <div className="field-error" role="alert">{failure}</div>}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
              {file ? "Escolher outro arquivo" : "Escolher arquivo"}
            </button>
            {!result && <button type="button" className="btn primary" disabled={busy || !preview?.previewToken} onClick={() => void confirm()}>Importar</button>}
            {failure && operationId && preview?.previewToken && !result && <button type="button" className="btn ghost" onClick={() => void check()}>Verificar resultado</button>}
          </div>
        </div>
      </div>
    </section>
  );
}

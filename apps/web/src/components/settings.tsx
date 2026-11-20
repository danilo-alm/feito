"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { api, ApiFailure, errorMessage } from "@feito/ui/client/api";
import { clearCache } from "@feito/ui/client/store";
import type { ImportPreview, ImportResult } from "@feito/core/types";
import { useApp } from "@feito/ui/components/app";
import { IconAlert, IconDownload, IconLock, IconLogout, IconMail, IconUpload } from "@feito/ui/components/icons";
import { Monogram, useImportDialog } from "@feito/ui/components/import-panel";
import { SettingsGroup, SettingsLinkRow, SettingsRow } from "@feito/ui/components/settings";
import { useToast } from "@feito/ui/components/ui";
import { importSources } from "@feito/core/domain/import-sources";

/** Conta da instalação web: e-mail, troca de senha e saída. */
export function AccountSettings() {
  const app = useApp();
  const router = useRouter();
  const logout = async () => {
    await api.auth.logout().catch(() => undefined);
    clearCache();
    router.replace("/entrar");
  };
  return (
    <SettingsGroup id="conta" title="Conta">
      <div className="set-card">
        <SettingsRow icon={<IconMail />} label="E-mail de acesso" hint={app.me.user.email} />
        <SettingsLinkRow href="/trocar-senha" icon={<IconLock />} label="Trocar senha"
          hint="Esqueceu a senha? Quem administra esta instalação pode redefini-la." />
        <SettingsRow icon={<IconLogout />} label="Sessão" hint="Sair deste navegador."
          control={<button type="button" className="btn ghost danger" onClick={() => void logout()}>Sair</button>} />
      </div>
    </SettingsGroup>
  );
}

function countsText(counts: NonNullable<ImportPreview["counts"]>) {
  return `${counts.projects} projetos · ${counts.archivedProjects} arquivados · ${counts.sections} seções · ${counts.tasks} tarefas`
    + ` (${counts.completedTasks} concluídas) · ${counts.labels} etiquetas · ${counts.occurrences} ocorrências`;
}

/** Importação de outros apps, backup e restauração. */
export function DataSettings({ footer }: { footer?: ReactNode }) {
  const [importDialog, openImport] = useImportDialog();
  const names = importSources.map((source) => source.name).join(", ");
  return (
    <SettingsGroup id="dados" title="Dados" footer={footer}>
      <div className="set-card">
        <SettingsLinkRow onClick={() => openImport()} icon={<Monogram name={importSources[0].name} small />}
          label={`Importar do ${names}`} hint="Seus projetos entram como projetos novos. Nada do que já está no Feito muda." />
        <SettingsRow icon={<IconDownload />} label="Exportar backup"
          hint="Tudo em um arquivo JSON versionado e legível. Guarde em local privado."
          control={<a className="btn" href={api.portability.exportUrl()} download>Exportar</a>} />
        <RestoreRow />
      </div>
      {importDialog}
    </SettingsGroup>
  );
}

function RestoreRow() {
  const app = useApp();
  const toast = useToast();
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
      title: "Restaurar este backup?",
      body: "Os dados serão restaurados nesta conta. A operação é atômica: se algo falhar, nada muda.",
      confirmLabel: "Restaurar",
    });
    if (!ok) return;
    setBusy(true);
    setFailure(null);
    try {
      setResult(await api.portability.confirm(file, preview.previewToken, operationId));
      toast("Backup restaurado");
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

  const extra = (preview || failure || result) && (
    <div className="set-status" role="status">
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
      {!result && (preview?.previewToken || (failure && operationId)) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {preview?.previewToken && <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>Restaurar</button>}
          {failure && operationId && preview?.previewToken && <button type="button" className="btn ghost" onClick={() => void check()}>Verificar resultado</button>}
        </div>
      )}
    </div>
  );

  return (
    <SettingsRow icon={<IconUpload />} label="Restaurar backup"
      hint="Restaura um arquivo exportado pelo Feito. Só numa conta vazia, com apenas a Caixa de entrada inicial."
      control={<>
        <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" id="import-file" tabIndex={-1}
          aria-hidden="true" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy && !preview ? "Lendo arquivo…" : file ? "Escolher outro arquivo" : "Escolher arquivo"}
        </button>
      </>}
      extra={extra} />
  );
}

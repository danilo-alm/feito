"use client";

import { translateMessage, translate as t } from "@feito/ui/client/locale";
import { useT } from "@feito/ui/components/language";

import { useRef, useState, type ReactNode } from "react";
import { api, ApiFailure, errorMessage } from "@feito/ui/client/api";
import type { ImportPreview, ImportResult } from "@feito/core/types";
import { useApp } from "@feito/ui/components/app";
import { IconAlert, IconClock, IconDownload, IconLock, IconLogout, IconMail, IconMonitor, IconRepeat, IconUpload } from "@feito/ui/components/icons";
import { Monogram } from "@feito/ui/components/import-export-common";
import { useImportDialog } from "@feito/ui/components/import-export-dialogs";
import { AgendaSettings, AppearanceSettings, ArchivedSettings, SettingsGroup, SettingsLinkRow, SettingsRow, SettingsVersion } from "@feito/ui/components/settings";
import { version } from "../../package.json";
import { useToast } from "@feito/ui/components/ui";
import { importSources } from "@feito/core/domain/import-sources";
import { PageHeader } from "@feito/ui/components/chrome";
import { Link } from "@feito/ui/navigation";
import { persistBrowserData, useBrowserStatus, workspace } from "@/browser/client";
import { browserRouter } from "@/browser/navigation";
import { OfflineStatus } from "./offline-status";
import { ConnectionSettings } from "./connection-settings";
import { syncLabels, pendingLabel, discardMessage } from "./sync-labels";

export function BrowserSettings() {
  const t = useT();
  return (
    <>
      <PageHeader crumb={t("Conta e preferências")} mobileTitle={t("Ajustes")} back="/navegar" />
      <div className="content"><div className="settings">
        <div className="page-h">
          <h1 className="title">{t("Ajustes")}</h1>
          <p className="hint">{t("Conta, preferências e seus dados.")}</p>
        </div>
        <AppearanceSettings />
        <AgendaSettings />
        <AccountSettings />
        <OfflineStatus />
        <DataSettings />
        <ArchivedSettings />
        <SettingsVersion version={version} />
      </div></div>
    </>
  );
}

export function AccountSettings() {
  const t = useT();
  const app = useApp();
  const status = useBrowserStatus();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const local = status.space.kind === "local";
  const logout = async () => {
    setBusy(true);
    try {
      const { pending } = await workspace.logout(false, status.epoch);
      if (pending) {
        const confirmed = await app.confirm({
          title: t("Sair e descartar alterações?"), body: discardMessage(pending),
          confirmLabel: t("Sair e descartar"), danger: true,
        });
        if (!confirmed) return;
        await workspace.logout(true, status.epoch);
      }
      browserRouter.replace("/entrar");
    } catch {
      toast(t("Não foi possível apagar os dados da conta neste navegador. Tente de novo."), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  const localSpace = async () => {
    try {
      persistBrowserData();
      await workspace.openLocal();
      browserRouter.replace("/hoje");
    } catch {
      toast(t("Não foi possível abrir o espaço sem conta. Tente de novo."), { bad: true });
    }
  };

  const discard = async (id: string) => {
    const confirmed = await app.confirm({
      title: t("Descartar a alteração rejeitada?"), body: t("A sincronização vai continuar com as outras alterações da fila."),
      confirmLabel: t("Descartar alteração"), danger: true,
    });
    if (confirmed) await workspace.discardRejected(id).catch(() => {
      toast(t("Não foi possível descartar a alteração. Tente de novo."), { bad: true });
    });
  };

  if (local) return (
    <SettingsGroup id="conta" title={t("Espaço neste navegador")}>
      <div className="set-card">
        <SettingsRow icon={<IconMonitor />} label={t("Espaço sem conta")} hint={t("As tarefas deste espaço ficam neste navegador.")} />
        <SettingsLinkRow href="/entrar?reautenticar=1" icon={<IconMail />} label={t("Entrar em uma conta")}
          hint={t("Abra uma cópia sincronizada da sua conta em um espaço separado.")} />
      </div>
    </SettingsGroup>
  );

  return (
    <>
      <SettingsGroup id="conta" title={t("Conta")}>
        <div className="set-card">
          <SettingsRow icon={<IconMail />} label={t("E-mail de acesso")} hint={app.me.user.email} />
          {status.sync === "login" || status.sync === "offline"
            ? <SettingsRow icon={<IconLock />} label={t("Trocar senha")} hint={t("Conecte-se à conta para trocar a senha.")} />
            : <SettingsLinkRow href="/trocar-senha" icon={<IconLock />} label={t("Trocar senha")}
              hint={t("Quem administra esta instalação pode ajudar a recuperar o acesso.")} />}
          <SettingsLinkRow onClick={() => void localSpace()} icon={<IconMonitor />} label={t("Abrir espaço sem conta")}
            hint={t("A cópia e a fila desta conta ficam guardadas neste navegador.")} />
          <SettingsRow icon={<IconLogout />} label={t("Sessão")} hint={t("Apaga a cópia desta conta de todas as abas neste navegador.")}
            control={<button type="button" className="icon-btn" aria-label={t("Sair")} data-tooltip={t("Encerrar sessão")}
              disabled={busy} onClick={() => void logout()}><IconLogout /></button>} />
        </div>
      </SettingsGroup>
      <SettingsGroup id="sincronizacao" title={t("Sincronização")}>
        <div className="set-card">
          <SettingsRow icon={<IconClock />} label={<span role="status">{t(syncLabels[status.sync])}</span>}
            hint={status.pending ? pendingLabel(status.pending) : t("Nenhuma alteração pendente.")}
            control={<><ConnectionSettings email={app.me.user.email} />{status.sync === "login"
              ? <Link className="btn" href="/entrar?reautenticar=1&voltar=%2Fajustes">{t("Entrar novamente")}</Link>
              : <button type="button" className="icon-btn" aria-label={t("Sincronizar agora")} data-tooltip={t("Sincronizar agora")} disabled={status.sync === "syncing"}
                onClick={() => void workspace.sync({ force: true })}><IconRepeat /></button>}</>}
            extra={(status.error || status.notice || status.blocked) && <div className="set-status">
              {status.error && <p className="field-error" role="alert">{status.error && t(status.error)}</p>}
              {status.notice && <p className="hint">{status.notice && translateMessage(status.notice)}</p>}
              {status.blocked && <button type="button" className="btn ghost danger"
                onClick={() => void discard(status.blocked!)}>{t("Descartar alteração rejeitada")}</button>}
            </div>} />
        </div>
      </SettingsGroup>
    </>
  );
}

function countsText(counts: NonNullable<ImportPreview["counts"]>) {
  return t("{0} projetos · {1} arquivados · {2} seções · {3} tarefas", [counts.projects, counts.archivedProjects, counts.sections, counts.tasks])
    + t(" ({0} concluídas) · {1} etiquetas · {2} ocorrências", [counts.completedTasks, counts.labels, counts.occurrences]);
}

/** Importação de outros apps, backup e restauração. */
export function DataSettings({ footer }: { footer?: ReactNode }) {
  const t = useT();
  const status = useBrowserStatus();
  const app = useApp();
  const [importDialog, openImport] = useImportDialog();
  const importsAvailable = status.space.kind === "local" || (status.sync !== "offline" && status.sync !== "login");
  const names = importSources.map((source) => source.name).join(", ");
  return (
    <SettingsGroup id="dados" title={t("Dados")} footer={footer}>
      <div className="set-card">
        {importsAvailable
          ? <SettingsLinkRow onClick={() => openImport()} icon={<Monogram name={importSources[0].name} small />}
            label={t("Importar do {0}", [names])} hint={t("Os projetos do arquivo entram como projetos novos.")} />
          : <SettingsRow icon={<IconUpload />} label={t("Importar do {0}", [names])} hint={t("Conecte-se para importar nesta conta.")} />}
        <SettingsRow icon={<IconDownload />} label={t("Exportar backup")}
          hint={t("Tudo em um arquivo JSON versionado e legível. Guarde em local privado.")}
          control={<button type="button" className="btn" onClick={() => void app.run(api.portability.downloadBackup)}>{t("Exportar")}</button>} />
        {importsAvailable ? <RestoreRow /> : <SettingsRow icon={<IconUpload />} label={t("Restaurar backup")} hint={t("Conecte-se para restaurar nesta conta.")} />}
      </div>
      {importDialog}
    </SettingsGroup>
  );
}

function RestoreRow() {
  const t = useT();
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
      title: t("Restaurar este backup?"),
      body: t("O backup será restaurado neste espaço."),
      confirmLabel: t("Restaurar"),
    });
    if (!ok) return;
    setBusy(true);
    setFailure(null);
    try {
      setResult(await api.portability.confirm(file, preview.previewToken, operationId));
      toast(t("Backup restaurado"));
      void app.refresh();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "NETWORK_ERROR") {
        setFailure(t("A conexão caiu durante a importação. Verifique o resultado antes de tentar de novo."));
      } else {
        setFailure(error instanceof ApiFailure && error.code === "PREVIEW_EXPIRED" ? t("A prévia expirou. Escolha o arquivo de novo.") : errorMessage(error));
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
      setFailure(t("Nenhuma importação concluída com esta operação. Você pode tentar de novo."));
    }
  };

  const extra = (preview || failure || result) && (
    <div className="set-status" role="status">
      {file && <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{file.name}</div>}
      {result ? (
        <div style={{ color: "var(--accent-text)", fontWeight: 600 }}>{t("Restaurado:")}{" "}{countsText(result.summary)}</div>
      ) : preview && (
        <>
          {preview.counts && <div className="sub">{t("Versão")}{" "}{preview.schemaVersion} · {countsText(preview.counts)} · {preview.errors.length} {" "}{t("erros")}</div>}
          {preview.errors.slice(0, 6).map((item) => (
            <div key={item.path + item.message} className="field-error"><code>{item.path || t("arquivo")}</code>: {translateMessage(item.message)}</div>
          ))}
          {preview.errors.length > 6 && <div className="field-error">{t("e mais")}{" "}{preview.errors.length - 6} {" "}{t("erros.")}</div>}
          {!preview.errors.length && !preview.destinationEmpty && (
            <div style={{ display: "flex", gap: 8, color: "var(--late)", fontWeight: 600, alignItems: "flex-start" }}>
              <IconAlert className="sm" style={{ marginTop: 2 }} />
              {t("O destino já tem dados. Use um espaço vazio, com apenas a Entrada inicial.")}</div>
          )}
        </>
      )}
      {failure && <div className="field-error" role="alert">{translateMessage(failure)}</div>}
      {!result && (preview?.previewToken || (failure && operationId)) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {preview?.previewToken && <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>{t("Restaurar")}</button>}
          {failure && operationId && preview?.previewToken && <button type="button" className="btn ghost" onClick={() => void check()}>{t("Verificar resultado")}</button>}
        </div>
      )}
    </div>
  );

  return (
    <SettingsRow icon={<IconUpload />} label={t("Restaurar backup")}
      hint={t("Restaura um arquivo do Feito num espaço vazio, com apenas a Entrada inicial.")}
      control={<>
        <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" id="import-file" tabIndex={-1}
          aria-hidden="true" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy && !preview ? t("Lendo arquivo…") : file ? t("Escolher outro arquivo") : t("Escolher arquivo")}
        </button>
      </>}
      extra={extra} />
  );
}

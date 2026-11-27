import { useRef, useState } from "react";
import { useT } from "@feito/ui/components/language";
import { Dialog } from "@feito/ui/components/ui";
import type { OpenFailure } from "./data/desktop";

/** Tela de quando os dados locais não abrem. Só oferece recomeçar quando tentar de novo não basta. */
export function StorageError({ failure, onRetry, onStartOver }: {
  failure: OpenFailure;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const [title, explanation] = {
    "key-missing": [
      t("Não encontramos a chave dos seus dados"),
      t("A chave que protege os dados fica no cofre de senhas do sistema (no macOS, o app Acesso às Chaves). Sem ela, o que está guardado neste computador não pode ser aberto."),
    ],
    "vault-unavailable": [
      t("O Feito precisa de acesso ao cofre do sistema"),
      t("Desbloqueie o cofre de senhas do computador, permita o acesso do Feito e tente de novo. Seus dados continuam guardados."),
    ],
    unreadable: [
      t("Não foi possível desbloquear os dados do Feito"),
      t("A chave do cofre não abre os dados deste computador, ou os arquivos estão danificados."),
    ],
    "newer-version": [
      t("Atualize o Feito para abrir estes dados"),
      t("Os dados deste computador foram gravados por uma versão mais nova. Instale a versão mais recente e abra o Feito de novo."),
    ],
    storage: [
      t("Não foi possível abrir os dados do Feito"),
      t("Confira o espaço livre em disco e as permissões da pasta de dados e tente de novo."),
    ],
  }[failure];
  const canStartOver = failure === "key-missing" || failure === "unreadable";

  return (
    <main id="conteudo" className="desktop-space-start">
      <div role="alert" className="desktop-error-message">
        <h1 className="title">{title}</h1>
        <p>{explanation}</p>
      </div>
      {canStartOver && (
        <p className="sub">{t("Se não for possível recuperar a chave ou os arquivos, você pode começar do zero. O que já foi sincronizado continua no servidor.")}</p>
      )}
      <div className="desktop-inline">
        <button type="button" className="btn primary" onClick={onRetry}>{t("Tentar de novo")}</button>
        {canStartOver && (
          <button type="button" className="btn ghost danger" onClick={() => setConfirming(true)}>{t("Começar do zero…")}</button>
        )}
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("Começar do zero?")}
        initialFocus={cancel}
        footer={(
          <>
            <button ref={cancel} type="button" className="btn ghost" onClick={() => setConfirming(false)}>{t("Cancelar")}</button>
            <button type="button" className="btn danger" onClick={onStartOver}>{t("Começar do zero")}</button>
          </>
        )}
      >
        <div className="dialog-b desktop-error-details">
          <p>{t("O Feito vai abrir vazio, com um novo espaço local, e você precisará entrar de novo nos servidores. Tarefas guardadas somente neste computador e alterações ainda não sincronizadas deixam de aparecer.")}</p>
          <p>{t("Os arquivos antigos não são apagados: ficam na pasta “recovery”, dentro da pasta de dados do Feito.")}</p>
        </div>
      </Dialog>
    </main>
  );
}

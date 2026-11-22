import { translate as t } from "@feito/ui/client/locale";

export const syncLabels = {
  local: "Espaço sem conta", syncing: "Sincronizando", current: "Sincronizado", offline: "Sem conexão",
  login: "Entre novamente para sincronizar", error: "Sincronização interrompida",
};

export function pendingLabel(count: number) {
  return count === 1 ? t("1 alteração pendente") : t("{0} alterações pendentes", [count]);
}

export function discardMessage(count: number) {
  return t("{0}. Ao sair, a cópia desta conta e as alterações pendentes serão apagadas deste navegador.", [pendingLabel(count)]);
}

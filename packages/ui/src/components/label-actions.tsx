"use client";
import { useT } from "./language";

import type { Label } from "@feito/core/types";
import { useRouter } from "../navigation";
import { api } from "../client/api";
import { refreshLabels, useApp } from "./app";
import { IconEdit, IconTrash } from "./icons";
import type { MenuItem } from "./ui";

export function useLabelMenu(label: Label | undefined, active: boolean) {
  const t = useT();
  const app = useApp();
  const router = useRouter();

  return (): MenuItem[] => label ? [
    { label: t("Renomear etiqueta"), icon: <IconEdit />, onSelect: async () => {
      const name = await app.prompt({ title: t("Renomear etiqueta"), label: t("Nome"), initial: label.name, confirmLabel: t("Salvar") });
      if (name && name !== label.name) await app.run(() => api.labels.rename(label.id, label.revision, name), { success: t("Etiqueta renomeada"), revalidate: refreshLabels });
    } },
    "separator",
    { label: t("Excluir etiqueta…"), icon: <IconTrash />, danger: true, onSelect: async () => {
      const ok = await app.confirm({ title: t("Excluir a etiqueta “{0}”?", [label.name]), body: t("As tarefas continuam, só perdem esta etiqueta."), confirmLabel: t("Excluir"), danger: true });
      if (ok && await app.run(() => api.labels.remove(label.id, label.revision).then(() => true), { success: t("Etiqueta excluída"), revalidate: refreshLabels }) && active) router.push("/hoje");
    } },
  ] : [];
}

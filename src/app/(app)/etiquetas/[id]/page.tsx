"use client";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { api } from "@/client/api";
import { useQuery } from "@/client/store";
import type { LabelTasks, TaskItem } from "@/client/types";
import { useApp } from "@/components/app";
import { PageHeader } from "@/components/chrome";
import { FlatGroup } from "@/components/flat-list";
import { IconEdit, IconMore, IconTrash } from "@/components/icons";
import { useTaskActions } from "@/components/task-actions";
import { MenuButton, Spinner } from "@/components/ui";

export default function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const app = useApp();
  const router = useRouter();
  const actions = useTaskActions();
  const label = app.nav?.labels.find((item) => item.id === id);
  const query = useQuery<LabelTasks>(`label:${id}`, () => api.labels.tasks(id));
  const [more, setMore] = useState<TaskItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const next = cursor === undefined ? query.data?.nextCursor : cursor;

  const loadMore = async () => {
    if (!next) return;
    const page = await app.run(() => api.labels.tasks(id, next));
    if (page) {
      setMore((current) => [...current, ...page.tasks]);
      setCursor(page.nextCursor);
    }
  };

  const menu = () => label ? [
    { label: "Renomear etiqueta", icon: <IconEdit />, onSelect: async () => {
      const name = await app.prompt({ title: "Renomear etiqueta", label: "Nome", initial: label.name, confirmLabel: "Salvar" });
      if (name && name !== label.name) await app.run(() => api.labels.rename(label.id, label.revision, name), { success: "Etiqueta renomeada" });
    } },
    "separator" as const,
    { label: "Excluir etiqueta…", icon: <IconTrash />, danger: true, onSelect: async () => {
      const ok = await app.confirm({ title: `Excluir a etiqueta “${label.name}”?`, body: "As tarefas continuam, só perdem esta etiqueta.", confirmLabel: "Excluir", danger: true });
      if (ok && await app.run(() => api.labels.remove(label.id, label.revision).then(() => true), { success: "Etiqueta excluída" })) router.push("/hoje");
    } },
  ] : [];

  const tasks = [...(query.data?.tasks ?? []), ...more];
  return (
    <>
      <PageHeader crumb="Etiqueta" mobileTitle={label?.name} back="/navegar"
        tools={label && <MenuButton label="Ações da etiqueta" items={menu}><IconMore /></MenuButton>} />
      <div className="content">
        <div className="col">
          <div className="page-h"><h1 className="title">{label?.name ?? "Etiqueta"}</h1>
            {query.data && <span className="sub">{tasks.length}{next ? "+" : ""} tarefas ativas</span>}</div>
          {!query.data ? <Spinner /> : (
            <FlatGroup tasks={tasks} actions={actions}
              empty={<div className="empty"><strong>Nenhuma tarefa ativa</strong>Associe esta etiqueta a tarefas pelo detalhe.</div>} />
          )}
          {next && <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => void loadMore()}>Carregar mais</button>}
        </div>
      </div>
      {actions.moveDialog}
    </>
  );
}

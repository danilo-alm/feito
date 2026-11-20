"use client";
import { useRouter } from "../navigation";
import { use } from "react";
import { api } from "../client/api";
import { useQuery } from "../client/store";
import { useTaskPagination } from "../client/task-pagination";
import type { LabelTasks } from "@feito/core/types";
import { refreshLabels, useApp } from "../components/app";
import { PageHeader, PageTaskCount } from "../components/chrome";
import { FlatGroup } from "../components/flat-list";
import { IconEdit, IconMore, IconTrash } from "../components/icons";
import { useTaskActions } from "../components/task-actions";
import { MenuButton, ReadFallback, useContextMenu, useIsMobile } from "../components/ui";

export default function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const app = useApp();
  const router = useRouter();
  const actions = useTaskActions();
  const label = app.nav?.labels.find((item) => item.id === id);
  const contextMenu = useContextMenu(!!label);
  const mobile = useIsMobile();
  const key = `label:${id}`;
  const query = useQuery<LabelTasks>(key, () => api.labels.tasks(id));
  const pagination = useTaskPagination(key, query.data, "tasks", (cursor) => api.labels.tasks(id, cursor));

  const menu = () => label ? [
    { label: "Renomear etiqueta", icon: <IconEdit />, onSelect: async () => {
      const name = await app.prompt({ title: "Renomear etiqueta", label: "Nome", initial: label.name, confirmLabel: "Salvar" });
      if (name && name !== label.name) await app.run(() => api.labels.rename(label.id, label.revision, name), { success: "Etiqueta renomeada", revalidate: refreshLabels });
    } },
    "separator" as const,
    { label: "Excluir etiqueta…", icon: <IconTrash />, danger: true, onSelect: async () => {
      const ok = await app.confirm({ title: `Excluir a etiqueta “${label.name}”?`, body: "As tarefas continuam, só perdem esta etiqueta.", confirmLabel: "Excluir", danger: true });
      if (ok && await app.run(() => api.labels.remove(label.id, label.revision).then(() => true), { success: "Etiqueta excluída", revalidate: refreshLabels })) router.push("/hoje");
    } },
  ] : [];

  const { tasks, cursor } = pagination;
  const tools = (visible: boolean) => label && (
    <MenuButton label="Ações da etiqueta" items={menu} contextMenu={visible ? contextMenu : undefined}><IconMore /></MenuButton>
  );
  return (
    <>
      <PageHeader crumb="Etiqueta" mobileTitle={label?.name} back="/navegar" tools={tools(!mobile)} mobileTools={tools(mobile)} />
      <div className="content">
        <div className="col">
          <div className="page-h" onContextMenu={contextMenu.onContextMenu}><h1 className="title">{label?.name ?? "Etiqueta"}</h1>
            {query.data && <PageTaskCount count={tasks.length} more={Boolean(cursor)} />}</div>
          {!query.data ? <ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} /> : (
            <FlatGroup tasks={tasks} actions={actions}
              empty={<div className="empty"><strong>Nenhuma tarefa ativa</strong>Associe esta etiqueta a tarefas pelo detalhe.</div>} />
          )}
          {pagination.error && <p className="hint" role="alert">{pagination.error}</p>}
          {cursor && <button type="button" className="btn" style={{ marginTop: 12 }} disabled={pagination.loading}
            onClick={() => void pagination.loadMore()}>Carregar mais</button>}
        </div>
      </div>
      {actions.moveDialog}
    </>
  );
}

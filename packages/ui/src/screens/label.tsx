"use client";
import { useT } from "../components/language";

import { use } from "react";
import { api } from "../client/api";
import { useQuery } from "../client/store";
import { useTaskPagination } from "../client/task-pagination";
import type { LabelTasks } from "@feito/core/types";
import { useApp } from "../components/app";
import { PageHeader, PageTaskCount } from "../components/chrome";
import { FlatGroup } from "../components/flat-list";
import { IconMore } from "../components/icons";
import { useLabelMenu } from "../components/label-actions";
import { useTaskActions } from "../components/task-actions";
import { MenuButton, ReadFallback, useContextMenu, useIsMobile } from "../components/ui";

export default function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const { id } = use(params);
  const app = useApp();
  const actions = useTaskActions();
  const label = app.nav?.labels.find((item) => item.id === id);
  const contextMenu = useContextMenu(!!label);
  const mobile = useIsMobile();
  const menu = useLabelMenu(label, true);
  const key = `label:${id}`;
  const query = useQuery<LabelTasks>(key, () => api.labels.tasks(id));
  const pagination = useTaskPagination(key, query.data, "tasks", (cursor) => api.labels.tasks(id, cursor));

  const { tasks, cursor } = pagination;
  const tools = (visible: boolean) => label && (
    <MenuButton label={t("Ações da etiqueta")} items={menu} contextMenu={visible ? contextMenu : undefined}><IconMore /></MenuButton>
  );
  return (
    <>
      <PageHeader crumb={t("Etiqueta")} mobileTitle={label?.name} back="/navegar" tools={tools(!mobile)} mobileTools={tools(mobile)} />
      <div className="content">
        <div className="col">
          <div className="page-h" onContextMenu={contextMenu.onContextMenu}><h1 className="title">{label?.name ?? t("Etiqueta")}</h1>
            {query.data && <PageTaskCount count={tasks.length} more={Boolean(cursor)} />}</div>
          {!query.data ? <ReadFallback error={query.error} loading={query.loading} onRetry={query.reload} /> : (
            <FlatGroup tasks={tasks} actions={actions}
              empty={<div className="empty"><strong>{t("Nenhuma tarefa ativa")}</strong>{t("Associe esta etiqueta a tarefas pelo detalhe.")}</div>} />
          )}
          {pagination.error && <p className="hint" role="alert">{pagination.error}</p>}
          {cursor && <button type="button" className="btn" style={{ marginTop: 12 }} disabled={pagination.loading}
            onClick={() => void pagination.loadMore()}>{t("Carregar mais")}</button>}
        </div>
      </div>
      {actions.moveDialog}
    </>
  );
}

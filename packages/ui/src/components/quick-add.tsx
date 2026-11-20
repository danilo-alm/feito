"use client";
import { usePathname } from "../navigation";
import { useMemo, useRef } from "react";
import { getQueryData } from "../client/store";
import { useApp, type QuickAddDefaults } from "./app";
import { destinationLabel } from "./pickers";
import { createFromDraft, draftFromDefaults, sectionNameOf, TaskEditor } from "./task-editor";
import { Dialog } from "./ui";

function inferDefaults(pathname: string, reference: string): QuickAddDefaults {
  if (pathname.startsWith("/hoje")) return { dueDate: reference };
  const project = pathname.match(/^\/projetos\/([^/]+)/);
  if (project) return { projectId: project[1] };
  const label = pathname.match(/^\/etiquetas\/([^/]+)/);
  if (label) return { labelIds: [label[1]] };
  return {};
}

export function QuickAdd({ defaults, onClose }: { defaults: QuickAddDefaults | null; onClose: () => void }) {
  const app = useApp();
  const pathname = usePathname();
  const open = defaults !== null;
  const inboxId = app.nav?.inbox.projectId ?? app.me.inboxProjectId;
  const round = useRef(0);
  const titleRef = useRef<HTMLInputElement>(null);
  // Cada abertura começa um formulário novo (a chave remonta o editor).
  const session = useMemo(() => {
    if (!defaults) return null;
    const initial = Object.keys(defaults).length ? defaults : inferDefaults(pathname, app.reference);
    round.current += 1;
    // `after` avança a cada criação "abaixo de", mantendo a ordem de digitação. Envios seguidos não esperam a
    // resposta: cada um vai depois do anterior quando ele for confirmado.
    return {
      key: round.current, initial, draft: draftFromDefaults(initial, inboxId),
      after: Promise.resolve(initial.afterId) as Promise<string | undefined>,
    };
  }, [defaults, pathname, app.reference, inboxId]);
  const parentId = session?.initial.parentId ?? null;
  const parentTitle = parentId ? getQueryData<{ title: string }>(`task:${parentId}`)?.title : undefined;

  return (
    <Dialog open={open} onClose={onClose} title="Adicionar tarefa" hideHeader initialFocus={titleRef} width={640}>
      {session && (
        <TaskEditor
          key={session.key}
          variant="dialog"
          titleRef={titleRef}
          initial={session.draft}
          parentTitle={parentId ? parentTitle ?? "tarefa" : undefined}
          lockDestination={!!parentId}
          canRepeat={!parentId}
          submitLabel="Adicionar tarefa"
          resetOnSubmit
          onCancel={onClose}
          hint={(
            <span className="hint desktop-only" style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 4 }}>
              <span className="kbd">Enter</span>adiciona
            </span>
          )}
          onSubmit={async (draft) => {
            const samePlace = draft.projectId === session.draft.projectId && draft.sectionId === session.draft.sectionId;
            const create = (afterId?: string) => app.run(() => createFromDraft(draft, {
              parentId, ...(samePlace ? { beforeId: session.initial.beforeId, afterId } : {}),
            }, app.taskContext), {
              success: `Tarefa adicionada em ${parentId ? `“${parentTitle ?? "tarefa"}”`
                : destinationLabel(app, draft.projectId, sectionNameOf(draft.projectId, draft.sectionId))}`,
            });
            if (!samePlace || !session.initial.afterId) return !!await create();
            const attempt = session.after.then(async (afterId) => ({ afterId, created: await create(afterId) }));
            session.after = attempt.then(({ afterId, created }) => created?.id ?? afterId);
            return !!(await attempt).created;
          }}
        />
      )}
    </Dialog>
  );
}

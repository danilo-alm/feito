import { defaultPreferences } from "../domain/preferences";
import { inboxName } from "../domain/product";
import { ApiError } from "../product/errors";
import { asProduct, type Workspace } from "../product/local-workspace";
import { defaultsForView } from "../validation/product";
import type { PortableDocument } from "./document";
import { exportDocument } from "./export";
import { remapForImport } from "./remap";

export function exportLocalWorkspace(workspace: Workspace) {
  return exportDocument(asProduct(workspace), workspace.preferences, workspace.occurrences);
}

export function localDestinationIsEmpty(workspace: Workspace) {
  const [inbox] = workspace.projects;
  if (workspace.projects.length !== 1 || !inbox.isInbox
    || workspace.sections.length || workspace.tasks.length || workspace.labels.length
    || workspace.taskLabels.length || workspace.occurrences.length) return false;
  const { preferences } = workspace;
  const { data } = inbox;
  return preferences.timezone === defaultPreferences.timezone && preferences.theme === defaultPreferences.theme
    // Accept untouched workspaces created with either the current or former default language.
    && (preferences.locale === undefined || preferences.locale === defaultPreferences.locale || preferences.locale === "pt-BR")
    && !data.archived && data.name === inboxName && !data.description
    && !data.defaultSectionName && data.color === null && data.icon === "hash"
    && data.view.layout === defaultsForView.layout && data.view.sortMode === defaultsForView.sortMode
    && data.view.showCompleted === defaultsForView.showCompleted;
}

export function restoreLocalWorkspace(workspace: Workspace, document: PortableDocument): Workspace {
  if (!localDestinationIsEmpty(workspace)) {
    throw new ApiError(409, "DESTINATION_NOT_EMPTY", "O espaço local de destino precisa estar vazio.");
  }
  const [inbox] = workspace.projects;
  const data = remapForImport(document, inbox.id, inbox.revision, () => globalThis.crypto.randomUUID());
  const taskLabels = new Map<string, string[]>();
  for (const { taskId, labelId } of data.taskLabels) {
    const labels = taskLabels.get(taskId);
    if (labels) labels.push(labelId);
    else taskLabels.set(taskId, [labelId]);
  }
  return { ...data, preferences: document.preferences, taskLabels: [...taskLabels] };
}

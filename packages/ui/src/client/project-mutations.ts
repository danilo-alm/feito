import type { Navigation, ProjectPage, ProjectStyle, ProjectSummary } from "@feito/core/types";
import { beginProjection, setQueryData, type QueryData } from "./store";

function patchNavigation(nav: Navigation | undefined, id: string, patch: (project: ProjectSummary) => ProjectSummary) {
  return nav && { ...nav, projects: nav.projects.map((project) => project.id === id ? patch(project) : project) };
}

function applyStyle(data: QueryData, id: string, style: Partial<ProjectStyle>) {
  const key = `project:${id}`;
  const page = data.get(key) as ProjectPage | undefined;
  if (page) data.set(key, { ...page, project: { ...page.project, ...style } });
  if (data.has("nav")) {
    data.set("nav", patchNavigation(data.get("nav") as Navigation | undefined, id, (project) => ({ ...project, ...style })));
  }
}

/** Aplica o projeto devolvido por uma escrita, sem voltar atrás de uma revisão mais nova. */
export function applySavedProject(saved: ProjectSummary) {
  const merge = <T extends { revision: number }>(project: T): T =>
    project.revision <= saved.revision ? { ...project, ...saved } : project;
  setQueryData<ProjectPage>(`project:${saved.id}`, (page) => page && { ...page, project: merge(page.project) });
  setQueryData<Navigation>("nav", (nav) => patchNavigation(nav, saved.id, merge));
}

/**
 * Mostra o novo ícone ou cor na hora, no título e na navegação, enquanto a escrita é enviada.
 * Em caso de falha, só esta previsão é descartada.
 */
export async function restyleProject<T>(id: string, style: Partial<ProjectStyle>, send: () => Promise<T>) {
  const projection = beginProjection((data) => applyStyle(data, id, style));
  try {
    return await send();
  } finally {
    projection.finish();
  }
}

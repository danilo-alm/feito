import "server-only";
import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { groupTasks, orderedSections, type Product, type Section } from "@/domain/product";
import { mutateProduct, readProduct, type ProductAccess } from "@/server/db/product";
import { readProjectView } from "@/server/db/product-reads";
import { ApiError } from "@/server/errors";
import { defaultsForView, type ProjectPayload, type ProjectView, type SectionPayload } from "@/validation/product";
import { inboxProject, labelSummaries, projectCounts, projectPage, projectSummaries, projectSummary, sectionDto, visibleTask } from "./product-dto";
import { nextRevision, protectInbox, requireRevision, validation, visibleRecord, writableProject } from "./product-rules";

function orderedProjects(product: Product, archived: boolean) {
  return [...product.projects.values()]
    .filter((project) => !project.isInbox && project.data.archived === archived)
    .sort((a, b) => Temporal.Instant.compare(a.data.createdAt, b.data.createdAt) || a.id.localeCompare(b.id));
}

export function getNavigation(access: ProductAccess) {
  return readProduct(access, (product) => {
    const inbox = inboxProject(product);
    const { activeCount } = projectCounts(product, inbox.id);
    const todayCount = [...product.tasks.values()].filter((task) =>
      visibleTask(product, task) && task.data.dueDate !== null && task.data.dueDate <= product.referenceDate,
    ).length;
    return {
      inbox: { projectId: inbox.id, activeCount },
      todayCount,
      projects: projectSummaries(product, orderedProjects(product, false)),
      archivedCount: orderedProjects(product, true).length,
      labels: labelSummaries(product),
      referenceDate: product.referenceDate,
    };
  });
}

export function listProjects(access: ProductAccess, status: "active" | "archived") {
  return readProduct(access, (product) => ({
    projects: projectSummaries(product, orderedProjects(product, status === "archived")),
  }));
}

export async function getProject(access: ProductAccess, id: string, includeCompleted?: boolean) {
  const { product, project } = await readProjectView(access, id);
  return projectPage(product, project, includeCompleted);
}

type NamedDetails = Pick<SectionPayload, "name" | "description">;
type ProjectDetails = Pick<ProjectPayload, "name" | "description" | "color" | "icon">;

export function createProject(access: ProductAccess, details: ProjectDetails) {
  const id = randomUUID();
  return mutateProduct(access, (product) => {
    const createdAt = product.now.toString();
    const project = { id, revision: 1, isInbox: false, data: { ...details, createdAt, archived: false, view: defaultsForView } };
    product.projects.set(id, project);
    return projectSummary(product, project);
  });
}

export function editProject(
  access: ProductAccess, id: string, revision: number, patch: Partial<ProjectDetails & Pick<ProjectPayload, "defaultSectionName">>,
) {
  return mutateProduct(access, (product, original) => {
    const current = visibleRecord(product.projects, id);
    protectInbox(current);
    writableProject(current);
    requireRevision(current, revision, () => projectSummary(product, current));
    const project = nextRevision(original.projects, { ...current, data: { ...current.data, ...patch } });
    product.projects.set(id, project);
    return projectSummary(product, project);
  });
}

export function updateProjectView(access: ProductAccess, id: string, patch: Partial<ProjectView>) {
  return mutateProduct(access, (product, original) => {
    const current = writableProject(visibleRecord(product.projects, id));
    if (current.isInbox && patch.layout === "board") throw validation("layout", "Use Lista na Caixa de entrada.");
    if (!Object.keys(patch).length) return current.data.view;
    const view = { ...current.data.view, ...patch };
    product.projects.set(id, nextRevision(original.projects, { ...current, data: { ...current.data, view } }));
    return view;
  });
}

export function setProjectArchived(access: ProductAccess, id: string, revision: number, archived: boolean) {
  return mutateProduct(access, (product, original) => {
    const current = visibleRecord(product.projects, id);
    protectInbox(current);
    requireRevision(current, revision, () => projectSummary(product, current));
    if (current.data.archived === archived) return projectSummary(product, current);
    const project = nextRevision(original.projects, { ...current, data: { ...current.data, archived } });
    product.projects.set(id, project);
    return projectSummary(product, project);
  });
}

export function deleteProject(access: ProductAccess, id: string, revision: number) {
  return mutateProduct(access, (product) => {
    const project = visibleRecord(product.projects, id);
    protectInbox(project);
    requireRevision(project, revision, () => projectSummary(product, project));
    const counts = projectCounts(product, id);
    if (counts.activeCount || counts.completedCount) {
      throw new ApiError(409, "PROJECT_NOT_EMPTY", "Exclua ou mova as tarefas antes de excluir o projeto.", counts);
    }
    for (const section of orderedSections(product, id)) product.sections.delete(section.id);
    product.projects.delete(id);
  });
}

type SectionAnchor = { afterSectionId?: string; beforeSectionId?: string };

function arrangeSections(product: Product, original: Product, section: Section, anchor: SectionAnchor) {
  const siblings = orderedSections(product, section.projectId).filter((sibling) => sibling.id !== section.id);
  const anchorId = anchor.afterSectionId ?? anchor.beforeSectionId;
  let index = siblings.length;
  if (anchorId) {
    const known = visibleRecord(product.sections, anchorId);
    const at = siblings.findIndex((sibling) => sibling.id === known.id);
    if (at < 0) throw new ApiError(422, "INVALID_ANCHOR", "Escolha outra seção do mesmo projeto.");
    index = at + Number(Boolean(anchor.afterSectionId));
  }
  siblings.splice(index, 0, section);
  for (const [position, sibling] of siblings.entries()) {
    if (sibling.id === section.id || sibling.data.position !== position) {
      product.sections.set(sibling.id, nextRevision(original.sections, {
        ...sibling, data: { ...sibling.data, position },
      }));
    }
  }
  return siblings.map((sibling) => sibling.id);
}

export function createSection(access: ProductAccess, projectId: string, details: NamedDetails, anchor: SectionAnchor) {
  const id = randomUUID();
  return mutateProduct(access, (product, original) => {
    const project = writableProject(visibleRecord(product.projects, projectId));
    protectInbox(project);
    arrangeSections(product, original, { id, projectId, revision: 1, data: { ...details, position: 0 } }, anchor);
    return sectionDto(product, visibleRecord(product.sections, id));
  });
}

function editableSection(product: Product, id: string, revision: number) {
  const section = visibleRecord(product.sections, id);
  writableProject(visibleRecord(product.projects, section.projectId));
  requireRevision(section, revision, () => sectionDto(product, section));
  return section;
}

export function editSection(access: ProductAccess, id: string, revision: number, patch: Partial<NamedDetails>) {
  return mutateProduct(access, (product, original) => {
    const current = editableSection(product, id, revision);
    const section = nextRevision(original.sections, { ...current, data: { ...current.data, ...patch } });
    product.sections.set(id, section);
    return sectionDto(product, section);
  });
}

export function moveSection(access: ProductAccess, id: string, revision: number, anchor: SectionAnchor) {
  return mutateProduct(access, (product, original) => {
    const section = editableSection(product, id, revision);
    return { sectionIds: arrangeSections(product, original, section, anchor) };
  });
}

export function deleteSection(access: ProductAccess, id: string, revision: number) {
  return mutateProduct(access, (product, original) => {
    const section = editableSection(product, id, revision);
    const rootGroup = { projectId: section.projectId, sectionId: null, parentId: null };
    const previousRoots = groupTasks(product, rootGroup);
    let position = (previousRoots.at(-1)?.data.position ?? -1) + 1;
    let movedTaskCount = 0;
    for (const root of groupTasks(product, { ...rootGroup, sectionId: id })) {
      product.tasks.set(root.id, nextRevision(original.tasks, {
        ...root, sectionId: null, data: { ...root.data, position: position++ },
      }));
      movedTaskCount++;
    }
    for (const task of product.tasks.values()) {
      if (task.sectionId !== id) continue;
      product.tasks.set(task.id, nextRevision(original.tasks, { ...task, sectionId: null }));
      movedTaskCount++;
    }
    product.sections.delete(id);
    return { movedTaskCount };
  });
}

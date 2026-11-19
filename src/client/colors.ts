// Cor de projetos e etiquetas. Etiquetas (e projetos sem cor escolhida) recebem os tons --tag-1…--tag-8
// em sequência pela ordem da barra lateral, então vizinhos não repetem a cor; fora do app (página pública)
// ou antes de a navegação carregar, o id escolhe o tom por hash. Projetos podem ter cor e ícone próprios.
import type { ProjectColor, ProjectIcon } from "@/validation/project-style";

const TONES = 8;
const order = new Map<string, number>();
const projects = new Map<string, { color: ProjectColor | null; icon: ProjectIcon }>();

type Styled = { id: string; color: ProjectColor | null; icon: ProjectIcon };

/** Registra a ordem e o estilo atuais de projetos e etiquetas (chamado quando a navegação carrega). */
export function registerTagOrder(projectList: Styled[], labelIds: string[]) {
  order.clear();
  projects.clear();
  projectList.forEach((project, index) => {
    order.set(project.id, index);
    projects.set(project.id, { color: project.color, icon: project.icon });
  });
  labelIds.forEach((id, index) => order.set(id, index));
}

function hash(id: string) {
  let value = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    value ^= id.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function tagColor(id: string | null | undefined) {
  if (!id) return undefined;
  return `var(--tag-${((order.get(id) ?? hash(id)) % TONES) + 1})`;
}

export function projectStyle(id: string | null | undefined) {
  const style = id ? projects.get(id) : undefined;
  return {
    icon: style?.icon ?? "hash" as ProjectIcon,
    color: style?.color ? `var(--proj-${style.color})` : tagColor(id),
  };
}

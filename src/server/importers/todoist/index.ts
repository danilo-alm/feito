import "server-only";
import { parseCsv } from "../csv";
import {
  plural, WarningCollector, type ImporterContext, type ImporterResult, type ImportIssue, type PlannedProject,
  type PlannedSection, type PlannedTask, type SourceFile,
} from "../plan";
import { parseTodoistDate } from "./dates";

// Formato: https://www.todoist.com/help/articles/import-or-export-a-project-as-a-CSV-file-in-todoist-YC8YvN
// Cabeçalho atual: TYPE, CONTENT, DESCRIPTION, ICON, IS_COLLAPSED, PRIORITY, INDENT, AUTHOR, RESPONSIBLE, DATE,
// DATE_LANG, TIMEZONE, DURATION, DURATION_UNIT, DEADLINE, DEADLINE_LANG, REMINDER_TYPE, REMINDER_OFFSET,
// REMINDER_DATE, REMINDER_DATE_LANG. Versões antigas têm menos colunas; só TYPE e CONTENT são exigidas.

const LIMITS = { title: 500, description: 10_000, name: 120 };
const LABEL = /(^|\s)@([^\s@]+)/gu;

type Row = { line: number; get: (column: string) => string };

function chars(value: string) {
  return [...value];
}

function clip(value: string, max: number) {
  const list = chars(value);
  return list.length <= max ? value : list.slice(0, max - 1).join("").trimEnd() + "…";
}

export function projectNameFromFile(fileName: string) {
  const base = fileName.normalize("NFC").replace(/^.*[\\/]/, "").replace(/\.csv$/i, "").trim();
  return clip(base || "Projeto importado", LIMITS.name);
}

function extractLabels(content: string) {
  const labels: string[] = [];
  const title = content.replace(LABEL, (_match, space: string, name: string) => {
    labels.push(name.normalize("NFC"));
    return space;
  }).replace(/\s+/g, " ").trim();
  return { title: title || content.trim(), labels: [...new Set(labels)].map((name) => clip(name, LIMITS.name)) };
}

function priorityOf(value: string): PlannedTask["priority"] {
  const number = Number(value);
  // No CSV do Todoist, 1 é p1 (mais alta), como no Feito.
  return number === 1 || number === 2 || number === 3 ? number : 4;
}

type Draft = { task: PlannedTask; notes: string[]; extras: string[]; nested: boolean };

function finish({ task, notes, extras, nested }: Draft, warnings: WarningCollector) {
  const blocks = [task.description.trim(), ...extras];
  if (notes.length) blocks.push(`Comentários do Todoist:\n${notes.map((note) => `- ${note}`).join("\n")}`);
  let description = blocks.filter(Boolean).join("\n\n");
  if (chars(description).length > LIMITS.description) {
    description = clip(description, LIMITS.description);
    warnings.add("long-description", (count) => `${plural(count, "descrição foi cortada", "descrições foram cortadas")} no limite de 10 000 caracteres.`);
  }
  task.description = description;
  if (task.recurrence && (nested || task.children.length > 0)) {
    warnings.add("recurrence-dropped", (count) => `${plural(count, "recorrência foi removida", "recorrências foram removidas")} de subtarefas ou tarefas com subtarefas; a próxima data foi mantida.`);
    task.recurrence = null;
  }
}

function parseFile(file: SourceFile, context: ImporterContext, warnings: WarningCollector, errors: ImportIssue[]) {
  const path = file.name;
  const { records, unterminated } = parseCsv(file.content);
  if (unterminated) errors.push({ path, message: "O arquivo termina no meio de um campo entre aspas." });
  const [header, ...body] = records;
  const columns = new Map((header?.cells ?? []).map((name, index) => [name.trim().toUpperCase(), index]));
  if (!columns.has("TYPE") || !columns.has("CONTENT")) {
    errors.push({ path, message: "Não parece uma exportação CSV do Todoist: faltam as colunas TYPE e CONTENT." });
    return null;
  }

  const project: PlannedProject = { name: projectNameFromFile(file.name), layout: "list", tasks: [], sections: [] };
  let section: PlannedSection | null = null;
  const drafts: Draft[] = [];
  const ancestors: { indent: number; task: PlannedTask }[] = [];
  let lastTask: Draft | null = null;

  for (const record of body) {
    if (record.cells.every((cell) => cell.trim() === "")) continue;
    const row: Row = { line: record.line, get: (column) => record.cells[columns.get(column) ?? -1]?.trim() ?? "" };
    const type = row.get("TYPE").toLowerCase();
    const content = row.get("CONTENT");

    if (type === "meta") {
      if (/^view_style\s*=\s*board$/i.test(content)) project.layout = "board";
      continue;
    }
    if (type === "section") {
      const name = content.normalize("NFC") || "Seção sem nome";
      if (chars(name).length > LIMITS.name) warnings.add("long-name", (count) => `${plural(count, "nome de seção foi cortado", "nomes de seção foram cortados")} em 120 caracteres.`);
      section = { name: clip(name, LIMITS.name), tasks: [] };
      project.sections.push(section);
      ancestors.length = 0;
      lastTask = null;
      continue;
    }
    if (type === "note") {
      if (!content) continue;
      if (lastTask) {
        lastTask.notes.push(content.normalize("NFC"));
        warnings.add("notes", (count) => `${plural(count, "comentário foi adicionado", "comentários foram adicionados")} à descrição da tarefa, pois o Feito não tem comentários.`);
      } else {
        warnings.add("orphan-notes", (count) => `${plural(count, "comentário de projeto foi ignorado", "comentários de projeto foram ignorados")}.`);
      }
      continue;
    }
    if (type !== "task") {
      warnings.add("unknown-type", (count) => `${plural(count, "linha com tipo desconhecido foi ignorada", "linhas com tipo desconhecido foram ignoradas")}.`);
      continue;
    }

    const { title: rawTitle, labels } = extractLabels(content.normalize("NFC"));
    if (!rawTitle) {
      errors.push({ path: `${path}:${row.line}`, message: "Tarefa sem conteúdo." });
      continue;
    }
    const extras: string[] = [];
    let title = rawTitle;
    if (chars(title).length > LIMITS.title) {
      title = clip(rawTitle, LIMITS.title);
      extras.push(`Título completo no Todoist:\n${rawTitle}`);
      warnings.add("long-title", (count) => `${plural(count, "título longo foi cortado", "títulos longos foram cortados")}; o texto completo está na descrição.`);
    }

    const dateText = row.get("DATE");
    const due = parseTodoistDate(dateText, row.get("DATE_LANG"), context.referenceDate);
    if (!due) {
      extras.push(`Data no Todoist: ${dateText}`);
      warnings.add("dates", (count) => `${plural(count, "data não foi reconhecida", "datas não foram reconhecidas")} (por exemplo, recorrências como “a cada 2 semanas”); o texto original ficou na descrição.`);
    }
    const deadline = row.get("DEADLINE");
    if (deadline) {
      extras.push(`Prazo no Todoist: ${deadline}`);
      warnings.add("deadline", (count) => `${plural(count, "prazo foi copiado", "prazos foram copiados")} para a descrição, pois o Feito não tem prazos.`);
    }
    if (row.get("RESPONSIBLE")) warnings.add("responsible", (count) => `${plural(count, "responsável foi ignorado", "responsáveis foram ignorados")}: o Feito é individual.`);
    if (row.get("DURATION")) warnings.add("duration", (count) => `${plural(count, "duração foi ignorada", "durações foram ignoradas")}.`);
    if (row.get("REMINDER_TYPE") || row.get("REMINDER_DATE")) warnings.add("reminder", (count) => `${plural(count, "lembrete foi ignorado", "lembretes foram ignorados")}.`);

    const task: PlannedTask = {
      title, description: row.get("DESCRIPTION").normalize("NFC"), priority: priorityOf(row.get("PRIORITY")),
      dueDate: due?.dueDate ?? null, dueTime: due?.dueTime ?? null, recurrence: due?.recurrence ?? null,
      labels, children: [],
    };

    const rawIndent = Number(row.get("INDENT"));
    const indent = Number.isSafeInteger(rawIndent) && rawIndent > 0 ? rawIndent : 1;
    while (ancestors.length && ancestors.at(-1)!.indent >= indent) ancestors.pop();
    const parent = ancestors.at(-1)?.task;
    if (parent) {
      parent.children.push(task);
    } else {
      if (indent > 1) warnings.add("orphan-subtask", (count) => `${plural(count, "subtarefa sem tarefa principal virou tarefa", "subtarefas sem tarefa principal viraram tarefas")}.`);
      (section ? section.tasks : project.tasks).push(task);
    }
    ancestors.push({ task, indent: parent ? indent : 1 });
    lastTask = { task, notes: [], extras, nested: !!parent };
    drafts.push(lastTask);
  }

  for (const draft of drafts) finish(draft, warnings);
  return project;
}

export function importTodoist(files: SourceFile[], context: ImporterContext): ImporterResult {
  const warnings = new WarningCollector();
  const errors: ImportIssue[] = [];
  const projects: PlannedProject[] = [];
  if (!files.length) errors.push({ path: "", message: "Envie ao menos um arquivo CSV." });
  for (const file of files) {
    const project = parseFile(file, context, warnings, errors);
    if (project) projects.push(project);
  }
  return { plan: errors.length ? null : { projects }, errors, warnings: warnings.list() };
}

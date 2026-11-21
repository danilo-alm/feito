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

function prefixEnd(value: string, max: number) {
  let end = 0;
  for (const char of value) {
    if (max-- === 0) break;
    end += char.length;
  }
  return end;
}

function clip(value: string, max: number) {
  if (value.length <= max || prefixEnd(value, max) === value.length) return value;
  return value.slice(0, prefixEnd(value, max - 1)).trimEnd() + "…";
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

type Draft = { task: PlannedTask; size: number; truncated: boolean; hasNotes: boolean; nested: boolean };

function appendDescription(draft: Draft, value: string) {
  if (draft.truncated) return;
  let end = 0;
  for (const char of value) {
    if (draft.size === LIMITS.description) break;
    draft.size += 1;
    end += char.length;
  }
  draft.task.description += value.slice(0, end);
  draft.truncated = end < value.length;
}

function appendBlock(draft: Draft, value: string) {
  if (!value) return;
  if (draft.size) appendDescription(draft, "\n\n");
  appendDescription(draft, value);
}

function finish(draft: Draft | null, warnings: WarningCollector) {
  if (!draft) return;
  const { task, nested, truncated } = draft;
  if (truncated) {
    task.description = task.description.slice(0, prefixEnd(task.description, LIMITS.description - 1)).trimEnd() + "…";
    warnings.add("long-description", (count) => `${plural(count, "descrição foi cortada", "descrições foram cortadas")} no limite de 10 000 caracteres.`);
  }
  if (task.recurrence && (nested || task.children.length > 0)) {
    warnings.add("recurrence-dropped", (count) => `${plural(count, "recorrência foi removida", "recorrências foram removidas")} de subtarefas ou tarefas com subtarefas; a próxima data foi mantida.`);
    task.recurrence = null;
  }
}

function parseFile(file: SourceFile, context: ImporterContext, warnings: WarningCollector, errors: ImportIssue[]) {
  const path = file.name;
  const csv = parseCsv(file.content);
  const firstError = errors.length;
  const reportUnterminated = () => {
    if (csv.unterminated) errors.splice(firstError, 0, { path, message: "O arquivo termina no meio de um campo entre aspas." });
  };
  const header = csv.records.next();
  const columns = new Map((header.done ? [] : header.value.cells).map((name, index) => [name.trim().toUpperCase(), index]));
  if (!columns.has("TYPE") || !columns.has("CONTENT")) {
    for (const _record of csv.records) { /* Valida as aspas mesmo quando o cabeçalho é inválido. */ }
    reportUnterminated();
    errors.push({ path, message: "Não parece uma exportação CSV do Todoist: faltam as colunas TYPE e CONTENT." });
    return null;
  }

  const project: PlannedProject = { name: projectNameFromFile(file.name), layout: "list", tasks: [], sections: [] };
  let section: PlannedSection | null = null;
  const finishWarnings = new WarningCollector();
  const ancestors: { indent: number; task: PlannedTask }[] = [];
  let lastTask: Draft | null = null;

  for (const record of csv.records) {
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
      const clipped = clip(name, LIMITS.name);
      if (clipped !== name) warnings.add("long-name", (count) => `${plural(count, "nome de seção foi cortado", "nomes de seção foram cortados")} em 120 caracteres.`);
      section = { name: clipped, tasks: [] };
      project.sections.push(section);
      ancestors.length = 0;
      finish(lastTask, finishWarnings);
      lastTask = null;
      continue;
    }
    if (type === "note") {
      if (!content) continue;
      if (lastTask) {
        if (!lastTask.truncated) {
          if (lastTask.hasNotes) appendDescription(lastTask, "\n- ");
          else appendBlock(lastTask, "Comentários do Todoist:\n- ");
          appendDescription(lastTask, content.normalize("NFC"));
          lastTask.hasNotes = true;
        }
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
    const title = clip(rawTitle, LIMITS.title);
    if (title !== rawTitle) {
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
      title, description: "", priority: priorityOf(row.get("PRIORITY")),
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
    finish(lastTask, finishWarnings);
    lastTask = { task, size: 0, truncated: false, hasNotes: false, nested: !!parent };
    appendBlock(lastTask, row.get("DESCRIPTION").normalize("NFC").trim());
    for (const extra of extras) appendBlock(lastTask, extra);
  }

  reportUnterminated();
  finish(lastTask, finishWarnings);
  warnings.merge(finishWarnings);
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

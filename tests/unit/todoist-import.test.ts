import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/server/importers/csv";
import { importTodoist, projectNameFromFile } from "@/server/importers/todoist";
import { parseTodoistDate } from "@/server/importers/todoist/dates";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/todoist/${name}`, import.meta.url), "utf8");
const today = "2026-11-19"; // quinta-feira
const HEADER = "TYPE,CONTENT,DESCRIPTION,ICON,IS_COLLAPSED,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG,REMINDER_TYPE,REMINDER_OFFSET,REMINDER_DATE,REMINDER_DATE_LANG";

function csv(...rows: string[]) {
  return `﻿${HEADER}\n${rows.join("\n")}\n`;
}

describe("CSV", () => {
  it("handles BOM, quoted commas, escaped quotes, multiline cells and CRLF", () => {
    const { records, unterminated } = parseCsv('﻿a,b\r\n"x, ""y""","linha 1\nlinha 2"\r\n,\r\n');
    expect(unterminated).toBe(false);
    expect(records).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ['x, "y"', "linha 1\nlinha 2"] },
      { line: 4, cells: ["", ""] },
    ]);
  });

  it("reports an unterminated quoted field", () => {
    expect(parseCsv('a\n"aberto').unterminated).toBe(true);
  });
});

describe("Todoist dates", () => {
  const due = (text: string, lang = "en") => parseTodoistDate(text, lang, today);
  const day = (dueDate: string, dueTime: string | null = null) => ({ dueDate, dueTime, recurrence: null });

  it("reads relative exports and Portuguese words", () => {
    expect(due("")).toEqual({ dueDate: null, dueTime: null, recurrence: null });
    expect(due("today")).toEqual(day("2026-11-19"));
    expect(due("tomorrow")).toEqual(day("2026-11-20"));
    expect(due("in 3 days")).toEqual(day("2026-11-22"));
    expect(due("in 2 weeks")).toEqual(day("2026-12-03"));
    expect(due("in one month")).toEqual(day("2026-12-19"));
    expect(due("amanhã", "pt_BR")).toEqual(day("2026-11-20"));
    expect(due("daqui a 5 dias", "pt_BR")).toEqual(day("2026-11-24"));
    expect(due("monday")).toEqual(day("2026-11-23"));
    expect(due("quinta-feira", "pt_BR")).toEqual(day("2026-11-26"));
    expect(due("next week")).toEqual(day("2026-11-23"));
  });

  it("reads absolute dates with optional year and time", () => {
    expect(due("nov 20", "pt")).toEqual(day("2026-11-20"));
    expect(due("Nov 20 2027")).toEqual(day("2027-11-20"));
    expect(due("20 de novembro", "pt_BR")).toEqual(day("2026-11-20"));
    expect(due("3 fev 2027 14:30", "pt_BR")).toEqual(day("2027-02-03", "14:30"));
    expect(due("Dec 1 at 9am")).toEqual(day("2026-12-01", "09:00"));
    expect(due("tomorrow 7:15 pm")).toEqual(day("2026-11-20", "19:15"));
    expect(due("hoje às 18h", "pt_BR")).toEqual(day("2026-11-19", "18:00"));
    expect(due("2026-12-24")).toEqual(day("2026-12-24"));
    expect(due("12/24/2026", "en")).toEqual(day("2026-12-24"));
    expect(due("24/12/2026", "pt_BR")).toEqual(day("2026-12-24"));
    expect(due("10:00")).toEqual(day("2026-11-19", "10:00"));
  });

  it("maps simple recurrences and rejects what the Feito cannot represent", () => {
    expect(due("every day")).toEqual({ dueDate: today, dueTime: null, recurrence: { frequency: "daily", anchorDate: today } });
    expect(due("every monday at 8am")).toEqual({ dueDate: "2026-11-23", dueTime: "08:00", recurrence: { frequency: "weekly", anchorDate: "2026-11-23" } });
    expect(due("toda quinta", "pt_BR")?.recurrence).toEqual({ frequency: "weekly", anchorDate: "2026-11-19" });
    expect(due("every 20th")?.recurrence).toEqual({ frequency: "monthly", anchorDate: "2026-11-20" });
    expect(due("todo dia 31", "pt_BR")?.recurrence).toEqual({ frequency: "monthly", anchorDate: "2026-12-31" });
    expect(due("every! week")?.recurrence?.frequency).toBe("weekly");
    expect(due("mensalmente", "pt_BR")?.recurrence?.frequency).toBe("monthly");
    expect(due("every 2 weeks")).toBeNull();
    expect(due("every workday")).toBeNull();
    expect(due("every year")).toBeNull();
    expect(due("feb 30")).toBeNull();
    expect(due("25:00")).toBeNull();
  });
});

describe("Todoist import", () => {
  const run = (content: string, name = "Projeto.csv") => importTodoist([{ name, content }], { referenceDate: today });

  it("imports the absolute-date export", () => {
    const { plan, errors, warnings } = run(fixture("casa-nova.csv"), "Casa Nova.csv");
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const [project] = plan!.projects;
    expect(project).toMatchObject({ name: "Casa Nova", layout: "list" });
    expect(project.tasks).toHaveLength(16);
    expect(project.sections).toEqual([{ name: "teste", tasks: [] }]);
    expect(project.tasks[0]).toEqual({
      title: "Ligar para a companhia de luz", description: "", priority: 1,
      dueDate: "2026-11-20", dueTime: null, recurrence: null, labels: [], children: [],
    });
    expect(project.tasks[3]).toMatchObject({ title: "Vazamento na pia", priority: 2 });
    expect(project.tasks[3].description).toContain('poça "misteriosa"');
    expect(project.tasks[5].description).toContain("\n\nDoar o que não for usado");
    expect(project.tasks[11].title).toBe('caixa de ferramentas, "chave inglesa", "trena" estão faltando.');
  });

  it("produces the same plan from the relative-date export when imported the day after export", () => {
    const absolute = run(fixture("casa-nova.csv")).plan;
    const relative = run(fixture("casa-nova-datas-relativas.csv")).plan;
    expect(relative).toEqual(absolute);
  });

  it("maps sections, subtasks, labels, notes, priorities and board view", () => {
    const { plan, errors, warnings } = run(csv(
      "meta,view_style=board,,,,,,,,,,,,,,,,,,",
      "task,Sem seção @casa,,,,,1,,,,,,,,,,,,,",
      "section,Semana,,,False,,,,,,,,,,,,,,,",
      "task,Comprar pão @casa @mercado,Integral,,,3,1,,,every monday,en,,,,,,,,,",
      "task,Pão,,,,4,2,,,,,,,,,,,,,",
      "task,Neto,,,,4,3,,Ana (1),,,,30,minute,,,,,,",
      "note,Lembrar do troco,,,,,,,,,,,,,,,,,,",
      "task,Revisar,,,,2,1,,,every 2 weeks,en,,,,dec 1,en,,,,",
    ));
    expect(errors).toEqual([]);
    const [project] = plan!.projects;
    expect(project.layout).toBe("board");
    expect(project.tasks).toMatchObject([{ title: "Sem seção", labels: ["casa"], priority: 4 }]);
    const [shopping, review] = project.sections[0].tasks;
    expect(shopping).toMatchObject({
      title: "Comprar pão", labels: ["casa", "mercado"], priority: 3, description: "Integral",
      dueDate: "2026-11-23", recurrence: null,
    });
    expect(shopping.children.map((child) => child.title)).toEqual(["Pão", "Neto"]);
    expect(shopping.children[1].description).toBe("Comentários do Todoist:\n- Lembrar do troco");
    expect(review).toMatchObject({ dueDate: null, recurrence: null });
    expect(review.description).toBe("Data no Todoist: every 2 weeks\n\nPrazo no Todoist: dec 1");
    expect(warnings).toEqual([
      "1 responsável foi ignorado: o Feito é individual.",
      "1 duração foi ignorada.",
      "1 subtarefa de nível profundo foi movida para o primeiro nível, pois o Feito aceita um nível de subtarefas.",
      "1 comentário foi adicionado à descrição da tarefa, pois o Feito não tem comentários.",
      "1 data não foi reconhecida (por exemplo, recorrências como “a cada 2 semanas”); o texto original ficou na descrição.",
      "1 prazo foi copiado para a descrição, pois o Feito não tem prazos.",
      "1 recorrência foi removida de subtarefas ou tarefas com subtarefas; a próxima data foi mantida.",
    ]);
  });

  it("keeps e-mail addresses and rejects files that are not Todoist exports", () => {
    expect(run(csv("task,Escrever para ana@exemplo.com,,,,,1,,,,,,,,,,,,,")).plan!.projects[0].tasks[0])
      .toMatchObject({ title: "Escrever para ana@exemplo.com", labels: [] });
    expect(run("nome,valor\nx,1\n").errors[0].message).toMatch(/TYPE e CONTENT/);
    expect(importTodoist([], { referenceDate: today }).plan).toBeNull();
  });

  it("names projects after the file", () => {
    expect(projectNameFromFile("Mudanc\u0327a.csv")).toBe("Mudança");
    expect(projectNameFromFile(".csv")).toBe("Projeto importado");
  });
});

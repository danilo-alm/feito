import { Temporal } from "@js-temporal/polyfill";
import { civilDate } from "../../../validation/product";
import type { PlannedTask } from "../plan";

/**
 * Interpreta a coluna DATE do CSV do Todoist. O Todoist exporta o texto de vencimento como o usuário
 * o vê: absoluto ("nov 20", "20 nov 2027 10:00", "every monday") ou, com “datas relativas”, em inglês
 * relativo ao dia da exportação ("tomorrow", "in 3 days"). Cobre inglês e português; o que não for
 * entendido devolve `null`, e quem chama preserva o texto original na descrição.
 *
 * Datas sem ano usam o ano de `today`: o Todoist omite o ano quando ele é o corrente.
 */
export type ParsedDue = Pick<PlannedTask, "dueDate" | "dueTime" | "recurrence">;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janeiro: 1,
  feb: 2, february: 2, fev: 2, fevereiro: 2,
  mar: 3, march: 3, marco: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mai: 5, maio: 5,
  jun: 6, june: 6, junho: 6,
  jul: 7, july: 7, julho: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, set: 9, setembro: 9,
  oct: 10, october: 10, out: 10, outubro: 10,
  nov: 11, november: 11, novembro: 11,
  dec: 12, december: 12, dez: 12, dezembro: 12,
};

// Temporal: 1 = segunda ... 7 = domingo.
const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, seg: 1, segunda: 1, "segunda-feira": 1,
  tue: 2, tues: 2, tuesday: 2, ter: 2, terca: 2, "terca-feira": 2,
  wed: 3, wednesday: 3, qua: 3, quarta: 3, "quarta-feira": 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, qui: 4, quinta: 4, "quinta-feira": 4,
  fri: 5, friday: 5, sex: 5, sexta: 5, "sexta-feira": 5,
  sat: 6, saturday: 6, sab: 6, sabado: 6,
  sun: 7, sunday: 7, dom: 7, domingo: 7,
};

const UNITS: Record<string, "days" | "weeks" | "months" | "years"> = {
  day: "days", days: "days", dia: "days", dias: "days",
  week: "weeks", weeks: "weeks", semana: "weeks", semanas: "weeks",
  month: "months", months: "months", mes: "months", meses: "months",
  year: "years", years: "years", ano: "years", anos: "years",
};

const ONE = new Set(["a", "an", "one", "um", "uma"]);

function dateToken<T>(tokens: Record<string, T>, text: string): T | undefined {
  return Object.hasOwn(tokens, text) ? tokens[text] : undefined;
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[,.]+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Extrai o horário e devolve o texto sem ele; `null` quando o horário é inválido. */
function takeTime(text: string): { rest: string; time: string | null } | null {
  const prefix = String.raw`(?:^|\s)(?:at |as |a |@ ?)?`;
  const patterns = [
    new RegExp(prefix + String.raw`(\d{1,2}):(\d{2}) ?(am|pm)?(?=\s|$)`),
    new RegExp(prefix + String.raw`(\d{1,2})()(?: ?)(am|pm)(?=\s|$)`),
    new RegExp(prefix + String.raw`(\d{1,2})h(\d{2})?()(?=\s|$)`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = match[3];
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
    }
    if (hour > 23 || minute > 59) return null;
    const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim();
    return { rest, time: `${pad(hour)}:${pad(minute)}` };
  }
  return { rest: text, time: null };
}

function makeDate(year: number, month: number, day: number) {
  try {
    return Temporal.PlainDate.from({ year, month, day }, { overflow: "reject" });
  } catch {
    return null;
  }
}

function nextWeekday(today: Temporal.PlainDate, weekday: number, includeToday: boolean) {
  let offset = (weekday - today.dayOfWeek + 7) % 7;
  if (offset === 0 && !includeToday) offset = 7;
  return today.add({ days: offset });
}

function nextMonthDay(today: Temporal.PlainDate, day: number) {
  for (let months = 0; months < 13; months += 1) {
    const month = today.toPlainYearMonth().add({ months });
    const candidate = makeDate(month.year, month.month, day);
    if (candidate && Temporal.PlainDate.compare(candidate, today) >= 0) return candidate;
  }
  return null;
}

function amount(word: string) {
  if (ONE.has(word)) return 1;
  // Todoist exports may express any supported civil date as days from today.
  return /^\d{1,7}$/.test(word) ? Number(word) : null;
}

function fullYear(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

/** Data única, sem horário e sem recorrência. */
function parseDay(text: string, today: Temporal.PlainDate, lang: string): Temporal.PlainDate | null {
  const words = text.replace(/^(?:on|no|na|em|dia) /, "");
  if (/^(?:today|tod|hoje)$/.test(words)) return today;
  if (/^(?:tomorrow|tom|tmr|amanha)$/.test(words)) return today.add({ days: 1 });
  if (/^(?:yesterday|ontem)$/.test(words)) return today.subtract({ days: 1 });
  if (/^(?:depois de amanha|day after tomorrow)$/.test(words)) return today.add({ days: 2 });
  if (/^(?:next week|proxima semana|semana que vem)$/.test(words)) return nextWeekday(today, 1, false);
  if (/^(?:next month|proximo mes|mes que vem)$/.test(words)) return today.toPlainYearMonth().add({ months: 1 }).toPlainDate({ day: 1 });
  if (/^(?:this weekend|weekend|fim de semana|neste fim de semana)$/.test(words)) return nextWeekday(today, 6, true);

  const relative = /^(?:in |em |daqui a |daqui )(\S+) (\S+)$/.exec(words) ?? /^(\d{1,7}) (\S+)(?: from now)?$/.exec(words);
  if (relative) {
    const unit = dateToken(UNITS, relative[2]);
    const count = amount(relative[1]);
    if (unit && count !== null) {
      try {
        return today.add({ [unit]: count });
      } catch {
        return null;
      }
    }
  }

  const weekday = /^(?:next |this |proxima |proximo |nesta |neste )?(\S+)$/.exec(words);
  const dayOfWeek = weekday && dateToken(WEEKDAYS, weekday[1]);
  if (dayOfWeek) return nextWeekday(today, dayOfWeek, false);

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(words);
  if (iso) return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(words);
  if (numeric) {
    const [first, second] = [Number(numeric[1]), Number(numeric[2])];
    const [month, day] = lang === "en" ? [first, second] : [second, first];
    return makeDate(fullYear(numeric[3], today.year), month, day);
  }

  const monthFirst = /^(\p{L}+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/u.exec(words);
  if (monthFirst) {
    const month = dateToken(MONTHS, monthFirst[1]);
    if (month) return makeDate(fullYear(monthFirst[3], today.year), month, Number(monthFirst[2]));
  }
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)? (?:de )?(\p{L}+)(?: (?:de )?(\d{4}))?$/u.exec(words);
  if (dayFirst) {
    const month = dateToken(MONTHS, dayFirst[2]);
    if (month) return makeDate(fullYear(dayFirst[3], today.year), month, Number(dayFirst[1]));
  }
  return null;
}

const EVERY = /^(?:every!?|ev!?|each|todos os|todas as|todo|toda|todos|todas|cada) (.+)$/;

function parseRecurrence(text: string, today: Temporal.PlainDate): ParsedDue | null {
  const simple: Record<string, "daily" | "weekly" | "monthly"> = {
    daily: "daily", diariamente: "daily", "todo dia": "daily", "todos os dias": "daily",
    weekly: "weekly", semanalmente: "weekly",
    monthly: "monthly", mensalmente: "monthly",
  };
  const anchored = (frequency: "daily" | "weekly" | "monthly", date: Temporal.PlainDate | null): ParsedDue | null =>
    date ? { dueDate: date.toString(), dueTime: null, recurrence: { frequency, anchorDate: date.toString() } } : null;
  const frequency = dateToken(simple, text);
  if (frequency) return anchored(frequency, today);

  const every = EVERY.exec(text);
  if (!every) return null;
  const rest = every[1].replace(/^(?:1|one|um|uma) /, "");
  if (/^(?:day|dia|dias)$/.test(rest)) return anchored("daily", today);
  if (/^(?:week|semana|semanas)$/.test(rest)) return anchored("weekly", today);
  if (/^(?:month|mes|meses)$/.test(rest)) return anchored("monthly", today);
  const dayOfWeek = dateToken(WEEKDAYS, rest);
  if (dayOfWeek) return anchored("weekly", nextWeekday(today, dayOfWeek, true));
  const monthDay = /^(?:dia )?(\d{1,2})(?:st|nd|rd|th)?(?: (?:of the month|do mes))?$/.exec(rest);
  if (monthDay && Number(monthDay[1]) >= 1 && Number(monthDay[1]) <= 31) {
    return anchored("monthly", nextMonthDay(today, Number(monthDay[1])));
  }
  return null;
}

export function parseTodoistDate(raw: string, lang: string, referenceDate: string): ParsedDue | null {
  const text = normalize(raw);
  if (!text) return { dueDate: null, dueTime: null, recurrence: null };
  const today = Temporal.PlainDate.from(referenceDate);
  const timed = takeTime(text);
  if (!timed) return null;
  const language = lang.toLowerCase().startsWith("en") ? "en" : "pt";

  if (EVERY.test(timed.rest) || /^(?:daily|weekly|monthly|diariamente|semanalmente|mensalmente)$/.test(timed.rest)) {
    const recurring = parseRecurrence(timed.rest, today);
    return recurring && civilDate.safeParse(recurring.dueDate).success ? { ...recurring, dueTime: timed.time } : null;
  }
  // Só um horário ("10:00") significa hoje, como no Todoist.
  const day = timed.rest === "" && timed.time ? today : parseDay(timed.rest, today, language);
  if (!day) return null;
  const dueDate = day.toString();
  return civilDate.safeParse(dueDate).success ? { dueDate, dueTime: timed.time, recurrence: null } : null;
}

// Datas civis (YYYY-MM-DD) exibidas em relação ao dia de referência do servidor.

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAYS_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro",
  "outubro", "novembro", "dezembro"];

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function utc(date: string) {
  const { year, month, day } = parts(date);
  return Date.UTC(year, month - 1, day);
}

export function weekday(date: string) {
  return new Date(utc(date)).getUTCDay();
}

export function addDays(date: string, days: number) {
  return new Date(utc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** "Hoje", "Amanhã", "Ontem" ou "Sex 20 nov" (com ano quando difere). */
export function dateLabel(date: string, reference: string) {
  const diff = daysBetween(reference, date);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  const { year, month, day } = parts(date);
  const base = `${WEEKDAYS[weekday(date)]} ${day} ${MONTHS[month - 1]}`;
  return year === parts(reference).year ? base : `${base} ${year}`;
}

export function dueLabel(date: string | null, time: string | null, reference: string) {
  if (!date) return null;
  return time ? `${dateLabel(date, reference)} ${time}` : dateLabel(date, reference);
}

/** "Terça, 17 de novembro" */
export function longDate(date: string) {
  const { month, day } = parts(date);
  return `${WEEKDAYS_LONG[weekday(date)]}, ${day} de ${MONTHS_LONG[month - 1]}`;
}

/** "Qua 18 nov" */
export function shortDate(date: string) {
  const { month, day } = parts(date);
  return `${WEEKDAYS[weekday(date)]} ${day} ${MONTHS[month - 1]}`;
}

export function dayParts(date: string) {
  return { weekday: WEEKDAYS[weekday(date)].toLowerCase(), day: parts(date).day };
}

export function monthTitle(date: string) {
  const { year, month } = parts(date);
  return `${MONTHS_LONG[month - 1][0].toUpperCase()}${MONTHS_LONG[month - 1].slice(1)} de ${year}`;
}

/** "18 – 24 nov" ou "29 nov – 5 dez" */
export function rangeLabel(start: string, end: string) {
  const a = parts(start);
  const b = parts(end);
  return a.month === b.month ? `${a.day} – ${b.day} ${MONTHS[b.month - 1]}`
    : `${a.day} ${MONTHS[a.month - 1]} – ${b.day} ${MONTHS[b.month - 1]}`;
}

/** Próxima segunda-feira estritamente depois da referência. */
export function nextWeek(reference: string) {
  const day = weekday(reference);
  return addDays(reference, ((8 - day) % 7) || 7);
}

/** Próximo sábado estritamente depois da referência ("Fim de semana"). */
export function weekend(reference: string) {
  return addDays(reference, ((6 - weekday(reference) + 7) % 7) || 7);
}

export function dayOfMonth(date: string) {
  return parts(date).day;
}

export function completedLabel(instant: string, reference: string, timezone?: string) {
  const date = new Date(instant);
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
  const diff = daysBetween(reference, local);
  if (diff === 0) return `Concluída hoje, ${time}`;
  if (diff === -1) return `Concluída ontem, ${time}`;
  return `Concluída em ${dateLabel(local, reference).toLowerCase()}`;
}

export const FREQUENCY_LABEL = { daily: "Diária", weekly: "Semanal", monthly: "Mensal" } as const;

const MONTH_INDEX: Record<string, number> = Object.fromEntries(MONTHS.map((name, index) => [name, index + 1]));
const WEEKDAY_INDEX: Record<string, number> = {
  dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, qua: 3, quarta: 3, qui: 4, quinta: 4, sex: 5, sexta: 5,
  sab: 6, sabado: 6,
};

function civil(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Interpreta um vencimento digitado: "hoje", "amanhã", "sexta", "fim de semana", "próxima semana",
 * "25/12", "25/12/2027", "25 dez", "dez 25" ou "2027-01-04". Datas sem ano vão para a próxima ocorrência.
 */
export function parseDueInput(input: string, reference: string): string | null {
  const text = input.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ")
    .replace(/-feira\b/, "");
  if (!text) return null;
  if (text === "hoje" || text === "hj") return reference;
  if (text === "amanha") return addDays(reference, 1);
  if (text === "depois de amanha") return addDays(reference, 2);
  if (/^(este |esse )?fim de semana$|^fds$/.test(text)) return weekend(reference);
  if (/^(proxima|prox) semana$/.test(text)) return nextWeek(reference);
  const inDays = text.match(/^(?:em )?(\d{1,3}) dias?$/);
  if (inDays) return addDays(reference, Number(inDays[1]));
  const day = WEEKDAY_INDEX[text.replace(/^(proxima|proximo|prox) /, "")];
  if (day !== undefined) return addDays(reference, ((day - weekday(reference) + 7) % 7) || 7);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return civil(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  let dayOf: number;
  let month: number;
  let yearText: string | undefined;
  const numeric = text.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  const dayFirst = text.match(/^(\d{1,2})(?: de)? ([a-z]{3})[a-z]*(?:(?: de)? (\d{4}))?$/);
  const monthFirst = text.match(/^([a-z]{3})[a-z]* (\d{1,2})(?: (\d{4}))?$/);
  if (numeric) [dayOf, month, yearText] = [Number(numeric[1]), Number(numeric[2]), numeric[3]];
  else if (dayFirst && MONTH_INDEX[dayFirst[2]]) [dayOf, month, yearText] = [Number(dayFirst[1]), MONTH_INDEX[dayFirst[2]], dayFirst[3]];
  else if (monthFirst && MONTH_INDEX[monthFirst[1]]) [dayOf, month, yearText] = [Number(monthFirst[2]), MONTH_INDEX[monthFirst[1]], monthFirst[3]];
  else return null;
  if (yearText) return civil(Number(yearText.length === 2 ? `20${yearText}` : yearText), month, dayOf);
  const thisYear = parts(reference).year;
  const candidate = civil(thisYear, month, dayOf);
  if (candidate && candidate >= reference) return candidate;
  return civil(thisYear + 1, month, dayOf);
}

/** Primeiro dia do mês ("2026-11-01"), deslocado em `offset` meses. */
export function monthStart(date: string, offset = 0) {
  const { year, month } = parts(date);
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export function daysInMonth(date: string) {
  const { year, month } = parts(date);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "Nov 2026" */
export function monthShort(date: string, withYear = true) {
  const { year, month } = parts(date);
  const name = `${MONTHS[month - 1][0].toUpperCase()}${MONTHS[month - 1].slice(1)}`;
  return withYear ? `${name} ${year}` : name;
}

export function weekdayShort(date: string) {
  return WEEKDAYS[weekday(date)];
}

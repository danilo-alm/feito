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

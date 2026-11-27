import { getLocale, intlLocale, translate as t } from "./locale";
import type { Locale } from "@feito/core/types";

// Datas civis (YYYY-MM-DD) exibidas em relação ao dia de referência do servidor.
// Os dois portugueses usam os nomes abaixo; os demais idiomas usam `Intl` em UTC, sem deslocar o dia.

type Formats = Record<"weekday" | "narrowWeekday" | "month" | "longDate" | "monthTitle" | "dayMonth", Intl.DateTimeFormat>;
const formatCache = new Map<Locale, Formats>();
function formats(locale: Locale = getLocale()): Formats {
  let cached = formatCache.get(locale);
  if (!cached) {
    const tag = intlLocale(locale);
    const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { timeZone: "UTC", ...options });
    cached = {
      weekday: format({ weekday: "short" }),
      narrowWeekday: format({ weekday: "narrow" }),
      month: format({ month: "short" }),
      longDate: format({ weekday: "long", day: "numeric", month: "long" }),
      monthTitle: format({ month: "long", year: "numeric" }),
      dayMonth: format({ day: "numeric", month: "short" }),
    };
    formatCache.set(locale, cached);
  }
  return cached;
}
const portuguese = (locale: Locale = getLocale()) => locale === "pt-BR" || locale === "pt-PT";
const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(intlLocale()) + text.slice(1);

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
  if (diff === 0) return t("Hoje");
  if (diff === 1) return t("Amanhã");
  if (diff === -1) return t("Ontem");
  const { year, month, day } = parts(date);
  const base = portuguese()
    ? `${WEEKDAYS[weekday(date)]} ${day} ${MONTHS[month - 1]}`
    : `${weekdayShort(date)} ${day} ${localMonth(date)}`;
  return year === parts(reference).year ? base : `${base} ${year}`;
}

export function dueLabel(date: string | null, time: string | null, reference: string) {
  if (!date) return null;
  return time ? `${dateLabel(date, reference)} ${time}` : dateLabel(date, reference);
}

/** "Terça, 17 de novembro" */
export function longDate(date: string) {
  const { month, day } = parts(date);
  if (!portuguese()) return capitalize(formats().longDate.format(utc(date)));
  return `${WEEKDAYS_LONG[weekday(date)]}, ${day} de ${MONTHS_LONG[month - 1]}`;
}

/** "Qua 18 nov" */
export function shortDate(date: string) {
  const { month, day } = parts(date);
  return portuguese() ? `${WEEKDAYS[weekday(date)]} ${day} ${MONTHS[month - 1]}` : `${weekdayShort(date)} ${day} ${localMonth(date)}`;
}

export function dayParts(date: string) {
  return { weekday: weekdayShort(date).toLowerCase(), day: parts(date).day };
}

export function monthTitle(date: string) {
  const { year, month } = parts(date);
  if (!portuguese()) return capitalize(formats().monthTitle.format(utc(date)));
  return `${MONTHS_LONG[month - 1][0].toUpperCase()}${MONTHS_LONG[month - 1].slice(1)} de ${year}`;
}

/** "18 – 24 nov" ou "29 nov – 5 dez" */
export function rangeLabel(start: string, end: string) {
  const a = parts(start);
  const b = parts(end);
  if (getLocale() === "en") return a.month === b.month ? `${a.day} – ${b.day} ${localMonth(end)}` : `${a.day} ${localMonth(start)} – ${b.day} ${localMonth(end)}`;
  if (!portuguese()) return formats().dayMonth.formatRange(utc(start), utc(end));
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
  const time = new Intl.DateTimeFormat(intlLocale(), { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
  const diff = daysBetween(reference, local);
  if (diff === 0) return t("Concluída hoje, {0}", [time]);
  if (diff === -1) return t("Concluída ontem, {0}", [time]);
  return t("Concluída em {0}", [dateInSentence(dateLabel(local, reference))]);
}

/** Data e hora de um comentário: "Hoje 10:52", "Ontem 10:52" ou a data seguida da hora. */
export function commentTimeLabel(instant: string, reference: string, timezone?: string) {
  const date = new Date(instant);
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date);
  const time = new Intl.DateTimeFormat(intlLocale(), { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);
  const diff = daysBetween(reference, local);
  const day = diff === 0 ? t("Hoje") : diff === -1 ? t("Ontem") : dateLabel(local, reference);
  return `${day} ${time}`;
}

/** Rótulo de data no meio da frase. Inglês e alemão mantêm as maiúsculas de dias e meses. */
export function dateInSentence(label: string) {
  const locale = getLocale();
  return locale === "en" || locale === "de" ? label : label.toLocaleLowerCase(intlLocale(locale));
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
export function parseDueInput(input: string, reference: string, locale: Locale = getLocale()): string | null {
  if (!portuguese(locale)) input = localizedDueInput(input, locale);
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
  const name = portuguese() ? `${MONTHS[month - 1][0].toUpperCase()}${MONTHS[month - 1].slice(1)}` : capitalize(localMonth(date));
  return withYear ? `${name} ${year}` : name;
}

export function weekdayShort(date: string) {
  return portuguese() ? WEEKDAYS[weekday(date)] : capitalize(formats().weekday.format(utc(date)));
}

const WEEK_HEAD = ["D", "S", "T", "Q", "Q", "S", "S"];
/** Iniciais dos dias da semana, de domingo a sábado, para o cabeçalho do calendário. */
export function weekHead() {
  if (portuguese()) return WEEK_HEAD;
  return Array.from({ length: 7 }, (_, day) => formats().narrowWeekday.format(Date.UTC(2026, 10, 15 + day)).toLocaleUpperCase(intlLocale()));
}

export type DueTone = "late" | "today" | "tomorrow" | "weekend" | "later" | "past";

/** Tom de cor de um vencimento: verde hoje, amarelo amanhã, azul este fim de semana, roxo adiante, vermelho atrasado. */
export function dueTone(date: string, reference: string, overdue = false): DueTone {
  const diff = daysBetween(reference, date);
  if (overdue) return "late";
  if (diff < 0) return "past";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  const day = weekday(date);
  if (diff <= 7 && (day === 0 || day === 6)) return "weekend";
  return "later";
}

function localMonth(date: string) {
  return formats().month.format(utc(date));
}

// Cada idioma é traduzido para as palavras do analisador em português, sem acentos.
// Mantém a semântica de data civil e o formato numérico dia/mês em todos os idiomas.
type Lexicon = {
  phrases: Record<string, string>;
  inDays: RegExp;
  next?: RegExp;
  words: Record<string, string>;
};
const WEEKDAY_PT = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const MONTH_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function names(weekdays: string[][], months: string[][]) {
  const words: Record<string, string> = {};
  weekdays.forEach((forms, day) => { for (const form of forms) words[form] = WEEKDAY_PT[day]; });
  months.forEach((forms, month) => { for (const form of forms) words[form] = MONTH_PT[month]; });
  return words;
}
const LEXICONS: Record<Exclude<Locale, "pt-BR" | "pt-PT">, Lexicon> = {
  en: {
    phrases: {
      today: "hoje", tomorrow: "amanha", "day after tomorrow": "depois de amanha",
      weekend: "fim de semana", "this weekend": "fim de semana", "next week": "proxima semana",
    },
    inDays: /^(?:in )?(\d{1,3}) days?$/,
    next: /^next (\S+)$/,
    words: names(
      [["sun", "sunday"], ["mon", "monday"], ["tue", "tuesday"], ["wed", "wednesday"], ["thu", "thursday"], ["fri", "friday"], ["sat", "saturday"]],
      [["jan", "january"], ["feb", "february"], ["mar", "march"], ["apr", "april"], ["may"], ["jun", "june"], ["jul", "july"],
        ["aug", "august"], ["sep", "sept", "september"], ["oct", "october"], ["nov", "november"], ["dec", "december"]],
    ),
  },
  es: {
    phrases: {
      hoy: "hoje", manana: "amanha", "pasado manana": "depois de amanha",
      "fin de semana": "fim de semana", "este fin de semana": "fim de semana",
      "proxima semana": "proxima semana", "la proxima semana": "proxima semana", "semana que viene": "proxima semana",
      "la semana que viene": "proxima semana",
    },
    inDays: /^(?:en |dentro de )?(\d{1,3}) dias?$/,
    next: /^(?:el )?proximo (\S+)$/,
    words: names(
      [["dom", "domingo"], ["lun", "lunes"], ["martes"], ["mie", "miercoles"], ["jue", "jueves"], ["vie", "viernes"], ["sab", "sabado"]],
      [["ene", "enero"], ["feb", "febrero"], ["mar", "marzo"], ["abr", "abril"], ["may", "mayo"], ["jun", "junio"], ["jul", "julio"],
        ["ago", "agosto"], ["sep", "sept", "set", "septiembre", "setiembre"], ["oct", "octubre"], ["nov", "noviembre"], ["dic", "diciembre"]],
    ),
  },
  fr: {
    phrases: {
      "aujourd'hui": "hoje", demain: "amanha", "apres-demain": "depois de amanha", "apres demain": "depois de amanha",
      "week-end": "fim de semana", weekend: "fim de semana", "ce week-end": "fim de semana", "ce weekend": "fim de semana",
      "semaine prochaine": "proxima semana", "la semaine prochaine": "proxima semana",
    },
    inDays: /^(?:dans )?(\d{1,3}) jours?$/,
    next: /^(\S+) prochain$/,
    words: names(
      [["dim", "dimanche"], ["lun", "lundi"], ["mar", "mardi"], ["mer", "mercredi"], ["jeu", "jeudi"], ["ven", "vendredi"], ["sam", "samedi"]],
      [["janv", "janvier"], ["fevr", "fevrier"], ["mars"], ["avr", "avril"], ["mai"], ["juin"], ["juil", "juillet"],
        ["aout"], ["sept", "septembre"], ["oct", "octobre"], ["nov", "novembre"], ["dec", "decembre"]],
    ),
  },
  it: {
    phrases: {
      oggi: "hoje", domani: "amanha", dopodomani: "depois de amanha",
      weekend: "fim de semana", "fine settimana": "fim de semana", "questo fine settimana": "fim de semana",
      "questo weekend": "fim de semana", "prossima settimana": "proxima semana", "la prossima settimana": "proxima semana",
      "settimana prossima": "proxima semana",
    },
    inDays: /^(?:tra |fra )?(\d{1,3}) giorni?$/,
    next: /^(?:il |la )?prossim[oa] (\S+)$/,
    words: names(
      [["dom", "domenica"], ["lun", "lunedi"], ["martedi"], ["mer", "mercoledi"], ["gio", "giovedi"], ["ven", "venerdi"], ["sab", "sabato"]],
      [["gen", "gennaio"], ["feb", "febbraio"], ["mar", "marzo"], ["apr", "aprile"], ["mag", "maggio"], ["giu", "giugno"], ["lug", "luglio"],
        ["ago", "agosto"], ["set", "sett", "settembre"], ["ott", "ottobre"], ["nov", "novembre"], ["dic", "dicembre"]],
    ),
  },
  de: {
    phrases: {
      heute: "hoje", morgen: "amanha", ubermorgen: "depois de amanha",
      wochenende: "fim de semana", "am wochenende": "fim de semana", "dieses wochenende": "fim de semana",
      "nachste woche": "proxima semana", "kommende woche": "proxima semana",
    },
    inDays: /^(?:in )?(\d{1,3}) tag(?:en)?$/,
    next: /^(?:nachste[nrs]?|kommende[nrs]?) (\S+)$/,
    words: names(
      [["so", "sonntag"], ["mo", "montag"], ["di", "dienstag"], ["mi", "mittwoch"], ["do", "donnerstag"], ["fr", "freitag"], ["sa", "samstag", "sonnabend"]],
      [["jan", "januar"], ["feb", "februar"], ["mar", "marz"], ["apr", "april"], ["mai"], ["jun", "juni"], ["jul", "juli"],
        ["aug", "august"], ["sep", "sept", "september"], ["okt", "oktober"], ["nov", "november"], ["dez", "dezember"]],
    ),
  },
};

function localizedDueInput(input: string, locale: Locale) {
  const lexicon = LEXICONS[locale as keyof typeof LEXICONS];
  if (!lexicon) return input;
  let text = input.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    // "25th", "1er", "25." e "1º" viram só o número; datas numéricas como "25.12." perdem o ponto final.
    .replace(/\b(\d{1,2})(?:st|nd|rd|th|er|e)\b/g, "$1").replace(/^(\d{1,2})\. (?=\D)/, "$1 ").replace(/(\d)\.$/, "$1");
  if (lexicon.phrases[text]) return lexicon.phrases[text];
  const days = lexicon.inDays.exec(text);
  if (days) return `em ${days[1]} dias`;
  const next = lexicon.next?.exec(text);
  if (next && lexicon.words[next[1]] && WEEKDAY_PT.includes(lexicon.words[next[1]])) return `proxima ${lexicon.words[next[1]]}`;
  text = text.replace(/[a-z]+/g, (word) => Object.hasOwn(lexicon.words, word) ? lexicon.words[word] : word);
  return text.replace(/^(\d{1,2}) (?:de|di) /, "$1 ").replace(/ (?:de|di) (\d{4})$/, " $1");
}

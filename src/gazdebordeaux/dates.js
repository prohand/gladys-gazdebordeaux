// -----------------------------------------------------------------------------
// Calendar days, in the time zone of Gaz de Bordeaux.
//
// The customer account dates every reading with a plain `YYYY-MM-DD` day of
// the French calendar, whatever the time zone of the machine running Gladys.
// Days are therefore handled as strings and computed in UTC arithmetic, which
// has no daylight-saving jump: only "today" depends on the Paris clock.
// -----------------------------------------------------------------------------

export const TIME_ZONE = 'Europe/Paris';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// `en-CA` formats a date as YYYY-MM-DD.
const parisFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The day of `date` in Paris, `YYYY-MM-DD`. */
export function parisDay(date = new Date()) {
  return parisFormatter.format(date);
}

/** True for a `YYYY-MM-DD` string naming a day that exists. */
export function isDay(value) {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) {
    return false;
  }
  return new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

/** `day` moved by `count` days (negative to go back). */
export function addDays(day, count) {
  const time = Date.parse(`${day}T00:00:00Z`) + count * DAY_MS;
  return new Date(time).toISOString().slice(0, 10);
}

/** The first day of the month of `day`. */
export function firstOfMonth(day) {
  return `${day.slice(0, 7)}-01`;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The instant a daily reading is dated with in Gladys: noon UTC, which is
 * always the same day in Paris (13:00 or 14:00 local time).
 */
export function noonOf(day) {
  return `${day}T12:00:00.000Z`;
}

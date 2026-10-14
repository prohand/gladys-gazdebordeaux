// -----------------------------------------------------------------------------
// The consumption payloads of the customer account, turned into plain data.
//
//   scale=month (+ startDate/endDate): one entry per day, keyed by the day,
//     plus a `total` entry:
//       { "2026-10-12": { kwh, volumeOfEnergy, price, ratio, temperature },
//         ..., "total": { kwh, volumeOfEnergy, price } }
//   scale=year: a `total` entry for the current year.
//
// Numbers sometimes come as strings (French decimal comma included) and a day
// not read yet may carry nulls: everything goes through `toNumber`.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, GdbError } from './client.js';
import { isDay } from './dates.js';

/** A finite number, or null. Accepts "12,5" as well as "12.5". */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function readingOf(entry) {
  return {
    kwh: toNumber(entry?.kwh ?? entry?.amountOfEnergy),
    volume: toNumber(entry?.volumeOfEnergy ?? entry?.volume),
    cost: toNumber(entry?.price ?? entry?.amount),
    temperature: toNumber(entry?.temperature),
  };
}

function assertObject(raw, what) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GdbError(ERROR_KINDS.API, `Unexpected ${what} payload from Gaz de Bordeaux`);
  }
}

/**
 * Daily readings, oldest first; days without a consumption are left out.
 * @returns {Array<{ date: string, kwh: number, volume: number | null, cost: number | null, temperature: number | null }>}
 */
export function parseDaily(raw) {
  assertObject(raw, 'daily consumption');
  return Object.entries(raw)
    .filter(([key]) => isDay(key))
    .map(([date, entry]) => ({ date, ...readingOf(entry) }))
    .filter((day) => day.kwh !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The `total` entry of a payload.
 * @returns {{ kwh: number | null, volume: number | null, cost: number | null }}
 */
export function parseTotal(raw) {
  assertObject(raw, 'total consumption');
  if (!raw.total || typeof raw.total !== 'object') {
    throw new GdbError(ERROR_KINDS.API, 'The Gaz de Bordeaux payload has no total');
  }
  const { kwh, volume, cost } = readingOf(raw.total);
  return { kwh, volume, cost };
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * The sum of the days from `fromDay` on. A quantity no day carries stays null
 * (an electricity contract has no gas volume).
 */
export function sumDays(days, fromDay) {
  const sum = { kwh: 0, volume: null, cost: null };
  for (const day of days) {
    if (day.date < fromDay) {
      continue;
    }
    sum.kwh += day.kwh;
    if (day.volume !== null) {
      sum.volume = (sum.volume ?? 0) + day.volume;
    }
    if (day.cost !== null) {
      sum.cost = (sum.cost ?? 0) + day.cost;
    }
  }
  return {
    kwh: round(sum.kwh, 3),
    volume: sum.volume === null ? null : round(sum.volume, 3),
    cost: sum.cost === null ? null : round(sum.cost, 2),
  };
}

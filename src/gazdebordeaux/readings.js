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

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** A finite number, or null. Accepts "12,5" as well as "12.5". */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

// The electricity days of a peak/off-peak contract carry the split
// (`consumptionHp` / `consumptionHc`, `priceHp` / `priceHc`) and flag it with
// `isHphc`: the website's own code then reads the split, not `kwh`, which such
// a day leaves at 0 (or null). The plain value wins only when the day is not
// flagged and carries more than nothing.
function splitOf(entry, peakKey, offPeakKey) {
  const peak = toNumber(entry?.[peakKey]);
  const offPeak = toNumber(entry?.[offPeakKey]);
  // Rounded to drop the float noise of the sum (4.2 + 2.1), no real digit.
  return peak === null && offPeak === null ? null : round((peak ?? 0) + (offPeak ?? 0), 6);
}

function plainOrSplit(plain, split, entry) {
  if (split !== null && (entry?.isHphc === true || !(plain > 0))) {
    return split;
  }
  return plain;
}

function kwhOf(entry) {
  return plainOrSplit(
    toNumber(entry?.kwh ?? entry?.amountOfEnergy),
    splitOf(entry, 'consumptionHp', 'consumptionHc'),
    entry,
  );
}

function costOf(entry) {
  // `price` is what the website exports as the day's expense, split or not.
  const price = toNumber(entry?.price ?? entry?.amount);
  return price > 0 ? price : (splitOf(entry, 'priceHp', 'priceHc') ?? price);
}

function readingOf(entry) {
  return {
    kwh: kwhOf(entry),
    volume: toNumber(entry?.volumeOfEnergy ?? entry?.volume),
    cost: costOf(entry),
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
 * How many days a payload gives, with a value or not: next to the days read,
 * it tells a support thread whether the website gave the recent days empty
 * or did not give them at all.
 */
export function givenDays(raw) {
  return Object.keys(raw ?? {}).filter(isDay).length;
}

/**
 * The field names of the latest day of a payload (never their values), logged
 * to check them on a real account: the field names come from the website's
 * own code, not from a documented API.
 */
export function latestDayFields(raw) {
  const latest = Object.keys(raw ?? {})
    .filter(isDay)
    .sort()
    .at(-1);
  const entry = latest ? raw[latest] : null;
  return entry && typeof entry === 'object' ? Object.keys(entry) : [];
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

// -----------------------------------------------------------------------------
// The "My Gaz de Bordeaux contract" energy contract template (manifest
// `energy_contracts`, `pricing_mode: "delegated"`): Gladys asks the
// integration the cost of the kWh, and the integration answers with the
// prices of the user's own contract, as espaceclient.gazdebordeaux.fr gives
// them. The user types no kWh price, and a price change needs no new
// contract: every day is priced with the prices read for that day.
//
// The prices of each espaceclient contract are kept in the store with the day
// they were first read (`price-history`): a retry of the core must get the
// same answer, and a past day keeps the prices it had. A day before the first
// read takes the first prices read (the best known).
//
// Peak/off-peak with daily readings: a day is split by the share of its hours
// in off-peak, as if the consumption were even over the day (an estimate; a
// half-hourly meter is priced exactly).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ENERGIES } from '../gazdebordeaux/client.js';
import { parseOffPeakTimes } from '../gazdebordeaux/prices.js';
import { TIME_ZONE } from '../gazdebordeaux/dates.js';

const logger = createLogger({ name: 'energy' });

/** The key of the delegated template in the manifest (never renamed). */
export const DELEGATED_TEMPLATE = 'espaceclient-elec';

const HISTORY_KEY = 'price-history';
const DAY_MINUTES = 24 * 60;
const HALF_HOUR_MINUTES = 30;

const LABELS = {
  base: 'Base',
  peak: 'Heures pleines',
  offPeak: 'Heures creuses',
  mixed: 'Heures pleines / creuses',
};

const PRICED_FIELDS = ['kwhPrice', 'peakPrice', 'offPeakPrice', 'offPeakSlots'];

const formatters = new Map();

// The local day and minute of the day of `date` in `timeZone`.
function localTime(date, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  const parts = Object.fromEntries(
    formatters
      .get(timeZone)
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const minuteOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** True when `minute` (of the day) falls in one of the `[start, end]` slots (end excluded). */
export function isOffPeak(minute, slots) {
  return slots.some(([start, end]) => {
    const from = minuteOf(start);
    const to = minuteOf(end);
    // An end at or before the start crosses midnight.
    return from < to ? minute >= from && minute < to : minute >= from || minute < to;
  });
}

/** Minutes in off-peak among the `duration` minutes from `start` (minute of the day). */
export function offPeakMinutes(start, duration, slots) {
  let count = 0;
  for (let i = 0; i < duration; i += 1) {
    if (isOffPeak((start + i) % DAY_MINUTES, slots)) {
      count += 1;
    }
  }
  return count;
}

// The priced part of a price read: what makes a new history entry.
const pricedOf = (prices) => Object.fromEntries(PRICED_FIELDS.map((f) => [f, prices[f] ?? null]));

/**
 * Keep the prices just read on espaceclient in the history of their
 * contract, dated `today`, when they differ from the last ones kept. Gas is
 * not kept: Gladys contracts are electricity only.
 * @param {Array<ReturnType<import('../gazdebordeaux/prices.js').currentPrices>>} pricesList
 * @param {{ store: object, today: string }} options
 */
export async function recordPriceHistory(pricesList, { store, today }) {
  const history = store.get(HISTORY_KEY);
  const patch = {};
  for (const prices of pricesList) {
    if (prices.energy !== ENERGIES.ELECTRICITY) {
      continue;
    }
    const priced = pricedOf(prices);
    if (priced.kwhPrice === null && priced.peakPrice === null && priced.offPeakPrice === null) {
      continue;
    }
    const entries = history[prices.id]?.entries ?? [];
    const last = entries.at(-1);
    if (last && JSON.stringify(pricedOf(last)) === JSON.stringify(priced)) {
      continue;
    }
    // Read twice the same day: the later read wins.
    const kept = last?.from === today ? entries.slice(0, -1) : entries;
    patch[prices.id] = { energy: prices.energy, entries: [...kept, { from: today, ...priced }] };
  }
  if (Object.keys(patch).length > 0) {
    store.update(HISTORY_KEY, patch);
    await store.save();
  }
}

// The price history of the electricity contract. Several electricity
// contracts on one account: the first one (logged).
function electricityHistory(store) {
  const contracts = Object.entries(store.get(HISTORY_KEY)).filter(
    ([, contract]) => contract.energy === ENERGIES.ELECTRICITY && contract.entries?.length > 0,
  );
  if (contracts.length === 0) {
    throw new Error(
      'The prices of the electricity contract were never read on espaceclient.gazdebordeaux.fr',
    );
  }
  if (contracts.length > 1) {
    logger.warn(
      `${contracts.length} electricity contracts on espaceclient: the prices of the first one are used`,
    );
  }
  return contracts.sort(([a], [b]) => a.localeCompare(b))[0][1].entries;
}

// The prices that applied on `day`: the last entry from that day or before,
// else the first one.
function entryAt(entries, day) {
  return entries.findLast((entry) => entry.from <= day) ?? entries[0];
}

// The peak/off-peak prices of an entry, or null on a base contract.
function peakOffPeakOf(entry, inputs) {
  if (entry.peakPrice === null || entry.offPeakPrice === null) {
    return null;
  }
  const slots = entry.offPeakSlots ?? parseOffPeakTimes(inputs?.off_peak_slots);
  if (!slots) {
    throw new Error(
      'Off-peak hours unknown: espaceclient does not give them, fill them in the contract',
    );
  }
  return { peak: entry.peakPrice, offPeak: entry.offPeakPrice, slots };
}

const round = (value) => Math.round(value * 1e6) / 1e6;

/**
 * The cost of every interval of an `energy-contract.price` request.
 * An interval starting at local midnight that carries a whole day (its kWh
 * over its peak power is more than an hour: the core derives that power from
 * the kWh and the length) is a day; any other a half-hour.
 * @param {import('@gladysassistant/integration-sdk').EnergyPriceRequest} request
 * @param {{ store: object }} options
 */
export function priceIntervals({ contract, intervals }, { store }) {
  const entries = electricityHistory(store);
  const timeZone = contract?.timezone || TIME_ZONE;
  return intervals.map(({ starts_at, kwh, max_power_kw }) => {
    const { day, minute } = localTime(new Date(starts_at), timeZone);
    const entry = entryAt(entries, day);
    const hp = peakOffPeakOf(entry, contract?.inputs);
    if (!hp) {
      if (entry.kwhPrice === null) {
        throw new Error(`No kWh price for ${day}`);
      }
      return { starts_at, cost: round(kwh * entry.kwhPrice), label: LABELS.base };
    }
    const wholeDay = minute === 0 && (!(max_power_kw > 0) || kwh / max_power_kw > 1);
    const duration = wholeDay ? DAY_MINUTES : HALF_HOUR_MINUTES;
    const share = offPeakMinutes(minute, duration, hp.slots) / duration;
    const label = share === 1 ? LABELS.offPeak : share === 0 ? LABELS.peak : LABELS.mixed;
    const cost = kwh * (share * hp.offPeak + (1 - share) * hp.peak);
    return { starts_at, cost: round(cost), label };
  });
}

/**
 * The price of the kWh now, and when it changes (`energy-contract.current`).
 * @param {import('@gladysassistant/integration-sdk').EnergyCurrentRequest} request
 * @param {{ store: object, now: Date }} options
 */
export function currentPrice({ contract }, { store, now }) {
  const entries = electricityHistory(store);
  const timeZone = contract?.timezone || TIME_ZONE;
  const { day, minute } = localTime(now, timeZone);
  const entry = entryAt(entries, day);
  const hp = peakOffPeakOf(entry, contract?.inputs);
  if (!hp) {
    return { price: entry.kwhPrice, valid_until: null, label: LABELS.base };
  }
  const offPeak = isOffPeak(minute, hp.slots);
  let minutes = 1;
  while (
    minutes < DAY_MINUTES &&
    isOffPeak((minute + minutes) % DAY_MINUTES, hp.slots) === offPeak
  ) {
    minutes += 1;
  }
  if (minutes === DAY_MINUTES) {
    // Off-peak all day long (or never): no change ahead.
    return {
      price: offPeak ? hp.offPeak : hp.peak,
      valid_until: null,
      label: offPeak ? LABELS.offPeak : LABELS.peak,
    };
  }
  const startOfMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  return {
    price: offPeak ? hp.offPeak : hp.peak,
    valid_until: new Date(startOfMinute + minutes * 60_000).toISOString(),
    next_price: offPeak ? hp.peak : hp.offPeak,
    label: offPeak ? LABELS.offPeak : LABELS.peak,
    next_label: offPeak ? LABELS.peak : LABELS.offPeak,
  };
}

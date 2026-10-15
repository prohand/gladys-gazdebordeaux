// -----------------------------------------------------------------------------
// The "My Gaz de Bordeaux contract" energy contract template (manifest
// `energy_contracts`, `pricing_mode: "delegated"`): Gladys asks the
// integration the cost of the kWh, and the integration answers with the
// prices of the user's own contract, as espaceclient.gazdebordeaux.fr gives
// them. The integration prices EVERY cost, the subscription included (the
// template has no `fixed` component): Gladys gives an integration no way to
// fill a contract in, so the user types nothing. A price change needs no new
// contract: every day is priced with the prices read for that day.
//
// The subscription is spread like the core spreads a monthly `fixed`
// component: the share of the month's minutes the interval covers.
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
import { addDays, daysBetween, firstOfMonth, TIME_ZONE } from '../gazdebordeaux/dates.js';

const logger = createLogger({ name: 'energy' });

/** The key of the delegated template in the manifest (never renamed). */
export const DELEGATED_TEMPLATE = 'espaceclient-elec';

/**
 * The key of the `rules` template that reads the kWh price from
 * PRICE_CALENDAR (never renamed): the core prices it itself.
 */
export const CALENDAR_TEMPLATE = 'espaceclient-elec-rules';

/**
 * The daily price calendar fed with the kWh price of the user's own
 * contract. Calendar keys usually carry no provider name (any provider may
 * feed a spot calendar); this one IS the price of a Gaz de Bordeaux account.
 */
export const PRICE_CALENDAR = 'gazdebordeaux-kwh-price';

// The window the core accepts: 5 years back (a day of margin), 7 days ahead.
const CALENDAR_DAYS_BACK = 5 * 365 - 1;
const CALENDAR_DAYS_AHEAD = 7;
const CALENDAR_ENTRIES_PER_CALL = 2000;

const HISTORY_KEY = 'price-history';
const DAY_MINUTES = 24 * 60;
const HALF_HOUR_MINUTES = 30;

const LABELS = {
  base: 'Base',
  peak: 'Heures pleines',
  offPeak: 'Heures creuses',
  mixed: 'Heures pleines / creuses',
};

const PRICED_FIELDS = [
  'kwhPrice',
  'peakPrice',
  'offPeakPrice',
  'offPeakSlots',
  'subscriptionPerMonth',
];

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

// The UTC instant (ms) of the local midnight starting `day` in `timeZone`.
function localMidnight(day, timeZone) {
  const wall = Date.parse(`${day}T00:00:00Z`);
  const offsetAt = (time) => {
    const local = localTime(new Date(time), timeZone);
    return Date.parse(`${local.day}T00:00:00Z`) + local.minute * 60_000 - time;
  };
  // Twice: the offset at the guess may differ from the one at midnight (DST).
  const guess = wall - offsetAt(wall);
  return wall - offsetAt(guess);
}

const minutesBetween = (from, to, timeZone) =>
  Math.round((localMidnight(to, timeZone) - localMidnight(from, timeZone)) / 60_000);

// The minutes of the local day and of the local month of `day` (DST included).
function dayMinutes(day, timeZone) {
  return minutesBetween(day, addDays(day, 1), timeZone);
}
function monthMinutes(day, timeZone) {
  const first = firstOfMonth(day);
  return minutesBetween(first, firstOfMonth(addDays(first, 32)), timeZone);
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
function electricityHistory(store, { quiet = false } = {}) {
  const contracts = Object.entries(store.get(HISTORY_KEY)).filter(
    ([, contract]) => contract.energy === ENERGIES.ELECTRICITY && contract.entries?.length > 0,
  );
  if (contracts.length === 0) {
    throw new Error(
      'The prices of the electricity contract were never read on espaceclient.gazdebordeaux.fr',
    );
  }
  if (contracts.length > 1 && !quiet) {
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

// The monthly subscription of an entry; an entry read before the subscription
// was kept takes the first one known. Null when espaceclient never gave it.
function subscriptionOf(entry, entries) {
  return (
    entry.subscriptionPerMonth ??
    entries.find((e) => e.subscriptionPerMonth != null)?.subscriptionPerMonth ??
    null
  );
}

// A contract made from the first version of the template carries the
// subscription as an input, which the core adds itself: never twice.
const coreAddsSubscription = (contract) => contract?.inputs?.subscription_per_month != null;

/**
 * The prices read on espaceclient as a Gladys tariff (the `rules` grammar of
 * the contract templates, values as the website gives them): what the user
 * pastes into a contract, as the core keeps no tariff for a delegated one.
 * Null for gas (Gladys contracts are electricity only) and when a price, or
 * the off-peak hours of a peak/off-peak contract, is missing.
 * @param {ReturnType<import('../gazdebordeaux/prices.js').currentPrices>} prices
 */
export function tariffOf(prices) {
  if (prices.energy !== ENERGIES.ELECTRICITY) {
    return null;
  }
  let energy;
  if (prices.peakPrice !== null && prices.offPeakPrice !== null) {
    if (!prices.offPeakSlots) {
      return null;
    }
    energy = {
      key: 'energy',
      kind: 'consumption',
      rules: [
        { label: LABELS.offPeak, when: { time: prices.offPeakSlots }, price: prices.offPeakPrice },
      ],
      fallback: { label: LABELS.peak, price: prices.peakPrice },
    };
  } else if (prices.kwhPrice !== null) {
    energy = {
      key: 'energy',
      kind: 'consumption',
      rules: [],
      fallback: { price: prices.kwhPrice },
    };
  } else {
    return null;
  }
  const components = [energy];
  if (prices.subscriptionPerMonth !== null) {
    components.push({
      key: 'subscription',
      kind: 'fixed',
      amount: prices.subscriptionPerMonth,
      per: 'month',
    });
  }
  return { tariff_version: 1, components };
}

/**
 * The cost of every interval of an `energy-contract.price` request: the kWh
 * and the share of the subscription (`components`: `energy`, `subscription`).
 * An interval starting at local midnight that carries a whole day (its kWh
 * over its peak power is more than an hour: the core derives that power from
 * the kWh and the length) is a day; any other a half-hour.
 * @param {import('@gladysassistant/integration-sdk').EnergyPriceRequest} request
 * @param {{ store: object }} options
 */
export function priceIntervals({ contract, intervals }, { store }) {
  const entries = electricityHistory(store);
  const timeZone = contract?.timezone || TIME_ZONE;
  const withSubscription = !coreAddsSubscription(contract);
  let subscriptionMissing = false;
  const costs = intervals.map(({ starts_at, kwh, max_power_kw }) => {
    const { day, minute } = localTime(new Date(starts_at), timeZone);
    const entry = entryAt(entries, day);
    const wholeDay = minute === 0 && (!(max_power_kw > 0) || kwh / max_power_kw > 1);
    const duration = wholeDay ? dayMinutes(day, timeZone) : HALF_HOUR_MINUTES;

    let energy;
    let label;
    const hp = peakOffPeakOf(entry, contract?.inputs);
    if (hp) {
      const share = offPeakMinutes(minute, duration, hp.slots) / duration;
      label = share === 1 ? LABELS.offPeak : share === 0 ? LABELS.peak : LABELS.mixed;
      energy = kwh * (share * hp.offPeak + (1 - share) * hp.peak);
    } else {
      if (entry.kwhPrice === null) {
        throw new Error(`No kWh price for ${day}`);
      }
      label = LABELS.base;
      energy = kwh * entry.kwhPrice;
    }

    const components = { energy: round(energy) };
    if (withSubscription) {
      const perMonth = subscriptionOf(entry, entries);
      if (perMonth === null) {
        subscriptionMissing = true;
      } else {
        components.subscription = round((perMonth * duration) / monthMinutes(day, timeZone));
      }
    }
    const cost = round(Object.values(components).reduce((sum, value) => sum + value, 0));
    return { starts_at, cost, components, label };
  });
  if (subscriptionMissing) {
    logger.warn('Subscription not given by espaceclient: only the kWh are priced');
  }
  return costs;
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

/**
 * The kWh price of a whole local day: the base price, or the peak and
 * off-peak prices weighted by the off-peak share of the day (consumption
 * assumed even over the day, like a daily reading of the delegated template).
 * Null when the day cannot be priced (peak/off-peak without its hours).
 */
export function dayPrice(entry, day, { inputs, timeZone = TIME_ZONE } = {}) {
  let hp;
  try {
    hp = peakOffPeakOf(entry, inputs);
  } catch {
    return null;
  }
  if (!hp) {
    return entry.kwhPrice;
  }
  const duration = dayMinutes(day, timeZone);
  const share = offPeakMinutes(0, duration, hp.slots) / duration;
  return round(share * hp.offPeak + (1 - share) * hp.peak);
}

/**
 * Feed PRICE_CALENDAR, read by the CALENDAR_TEMPLATE contracts: one price per
 * day from the earliest contract start (or the first price read) to 7 days
 * ahead, each day with the prices kept for it (a day before the first read
 * takes the first prices). Upserted: an unchanged day writes nothing, a
 * changed one makes the core recompute its costs. Nothing before a first
 * read: the contract then applies its fallback price.
 * @param {object} gladys
 * @param {{ store: object, today: string }} options
 * @returns {Promise<number>} the days published
 */
export async function publishPriceCalendar(gladys, { store, today }) {
  let entries;
  try {
    entries = electricityHistory(store, { quiet: true });
  } catch {
    return 0;
  }
  // An older Gladys lists no contract: the calendar is fed all the same.
  const contracts = (await gladys.getEnergyContracts().catch(() => [])).filter(
    (contract) => contract.template_key === CALENDAR_TEMPLATE,
  );
  const inputs = contracts.find((contract) => contract.inputs?.off_peak_slots)?.inputs;
  const oldest = addDays(today, -CALENDAR_DAYS_BACK);
  let from = [entries[0].from, ...contracts.map((contract) => contract.valid_from)]
    .filter(Boolean)
    .sort()[0];
  if (from < oldest) {
    from = oldest;
  }
  const days = daysBetween(from, today) + CALENDAR_DAYS_AHEAD + 1;
  const prices = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDays(from, i);
    const price = dayPrice(entryAt(entries, day), day, { inputs });
    if (price !== null) {
      prices.push({ date: day, price });
    }
  }
  for (let i = 0; i < prices.length; i += CALENDAR_ENTRIES_PER_CALL) {
    await gladys.publishEnergyCalendar(
      PRICE_CALENDAR,
      prices.slice(i, i + CALENDAR_ENTRIES_PER_CALL),
    );
  }
  return prices.length;
}

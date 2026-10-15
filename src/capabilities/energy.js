// -----------------------------------------------------------------------------
// The "My contract" energy contract template (manifest `energy_contracts`,
// `espaceclient-elec-rules`, `pricing_mode: "rules"`): the core rule engine
// prices it, the kWh price read in the daily price calendar the integration
// feeds with the prices of the user's own contract, as
// espaceclient.gazdebordeaux.fr gives them. Only the subscription is typed:
// a `fixed` amount cannot come from a calendar.
//
// The prices of each espaceclient contract are kept in the store with the day
// they were first read (`price-history`): a past day keeps the prices it had,
// a day before the first read takes the first prices read (the best known).
//
// Peak/off-peak: a day is priced by the share of its hours in off-peak, as if
// the consumption were even over the day (the readings are daily).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ENERGIES } from '../gazdebordeaux/client.js';
import { parseOffPeakTimes } from '../gazdebordeaux/prices.js';
import { addDays, daysBetween, TIME_ZONE } from '../gazdebordeaux/dates.js';

const logger = createLogger({ name: 'energy' });

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

const LABELS = {
  peak: 'Heures pleines',
  offPeak: 'Heures creuses',
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

// The minutes of the local day `day` (DST included).
function dayMinutes(day, timeZone) {
  return minutesBetween(day, addDays(day, 1), timeZone);
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

// The price history of the electricity contract, null before a first read.
// Several electricity contracts on one account: the first one.
function electricityHistory(store) {
  const contracts = Object.entries(store.get(HISTORY_KEY)).filter(
    ([, contract]) => contract.energy === ENERGIES.ELECTRICITY && contract.entries?.length > 0,
  );
  if (contracts.length > 1) {
    logger.debug(
      `${contracts.length} electricity contracts on espaceclient: the prices of the first one are used`,
    );
  }
  return contracts.sort(([a], [b]) => a.localeCompare(b))[0]?.[1].entries ?? null;
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
 * The prices read on espaceclient as a Gladys tariff (the `rules` grammar of
 * the contract templates, values as the website gives them): what the user
 * pastes into a contract of another template (fixed prices).
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
 * The kWh price of a whole local day: the base price, or the peak and
 * off-peak prices weighted by the off-peak share of the day (consumption
 * assumed even over the day: the readings are daily).
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
 * read: the contract prices nothing until the first one.
 * @param {object} gladys
 * @param {{ store: object, today: string }} options
 * @returns {Promise<number>} the days published
 */
export async function publishPriceCalendar(gladys, { store, today }) {
  const entries = electricityHistory(store);
  if (!entries) {
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

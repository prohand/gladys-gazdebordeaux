// -----------------------------------------------------------------------------
// The prices of the customer's OWN contract, read from the customer account.
//
// The price of a contract is not the one of the current grid: a fixed-price
// offer keeps the price of its subscription date, an indexed one (Ecodigo
// Elec) moves with taxes and market. The customer account says what is
// charged, indirectly: every day it gives the kWh and what they cost
// (`consumptionPrice`, or `priceHp` / `priceHc` with `consumptionHp` /
// `consumptionHc` on a peak/off-peak contract) and the share of the
// subscription (`contractPrice`).
//
// The website rounds each day's amounts to the cent: a day costing 1.28 €
// says the exact cost lies between 1.275 and 1.285 €, so each day bounds the
// price. Walking back from the latest day, every day narrows the range of
// prices they all allow, until two days in a row allow none of it: the price
// changed there (on a real account, 0.160164 €/kWh and 15.87 €/month since
// 1 October, more before; a 1 % tolerance missed it and blended both prices
// into 0.16066 and 16.01). The price is the middle of the range, rounded to 5
// decimals like the official grids.
// The user copies them into the Gladys contract wizard: Gladys gives an
// integration no way to fill a contract in.
// -----------------------------------------------------------------------------

/** Days the prices are computed over (the latest ones). */
export const PRICE_SAMPLE_DAYS = 30;

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const daysInMonth = (day) =>
  new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();

/** Half a cent: how far a day's amount, rounded to the cent, is from its exact value. */
const HALF_CENT = 0.005;

// Two amounts rounded to adjacent cents touch at one bound: that is no price
// in common (a rounded amount covers [x − ½ cent, x + ½ cent)).
const EPSILON = 1e-9;

function intersect(a, b) {
  if (!a || !b) {
    return null;
  }
  const range = [Math.max(a[0], b[0]), Math.min(a[1], b[1])];
  return range[1] - range[0] > EPSILON ? range : null;
}

/** The newest days a run may start from: one of them may be a pro-rata. */
const STARTS = 3;

// The latest run of days charged at one price.
// `waysOf(day)` gives, for each way the website may compute the amount, the
// range of prices the day allows (null for a way the day says nothing of), or
// null when the day carries no amount. Walking back from the newest day, a way
// a day contradicts is dropped; a day that fits no way left is skipped (a
// pro-rata, a correction), but two in a row that agree with each other are
// days at another price: the run stops there.
// Returns { from, changed, ranges } (ranges: per way, null once dropped), or
// null when no day carries an amount.
function latestRun(days, waysOf) {
  const entries = days
    .map((day) => ({ day, ways: waysOf(day) }))
    .filter(({ ways }) => ways !== null);
  if (entries.length === 0) {
    return null;
  }
  let best = null;
  for (let start = entries.length - 1; start >= Math.max(0, entries.length - STARTS); start -= 1) {
    let ranges = entries[start].ways;
    let from = start;
    let count = 1;
    let missed = null;
    let changed = false;
    for (let i = start - 1; i >= 0; i -= 1) {
      const narrowed = ranges.map((range, way) => intersect(range, entries[i].ways[way]));
      if (narrowed.some(Boolean)) {
        ranges = narrowed;
        from = i;
        count += 1;
        missed = null;
      } else if (
        missed !== null &&
        entries[i].ways.some((range, way) => intersect(range, entries[missed].ways[way]))
      ) {
        changed = true;
        break;
      } else {
        missed = i;
      }
    }
    if (best === null || count > best.count) {
      best = { from: entries[from].day.date, changed, ranges, count };
    }
  }
  return best;
}

const middleOf = (ranges) => {
  const range = ranges.find(Boolean);
  return range ? (range[0] + range[1]) / 2 : null;
};

// The kWh price, one way: the cost over the kWh.
const unitWays = (costOf, kwhOf) => (day) => {
  const cost = costOf(day);
  const kwh = kwhOf(day);
  if (cost === null || kwh === null || cost <= 0 || kwh <= 0) {
    return null;
  }
  return [[(cost - HALF_CENT) / kwh, (cost + HALF_CENT) / kwh]];
};

// The monthly subscription, two ways: the website spreads it over the year
// (monthly × 12 / 365 a day: the same share every day) or over the days of
// each month. Shares that never change say nothing of the way: the yearly one
// comes first, it was the one of a real account (0.52 € a day for 15.87 € in
// October, where the days of the month give 0.51).
function subscriptionWays(day) {
  const share = day.subscriptionCost;
  if (share === null || share <= 0) {
    return null;
  }
  return [365 / 12, daysInMonth(day.date)].map((days) => [
    (share - HALF_CENT) * days,
    (share + HALF_CENT) * days,
  ]);
}

// The energy cost of a day: given as is, or the total minus the subscription.
function energyCostOf(day) {
  if (day.energyCost !== null) {
    return day.energyCost;
  }
  if (day.cost !== null && day.subscriptionCost !== null) {
    return day.cost - day.subscriptionCost;
  }
  return null;
}

const TIME = /(\d{1,2})\s*[:hH]\s*(\d{2})?/;

function timeOf(value) {
  const match = String(value ?? '').match(TIME);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 24 || minutes > 59) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// One off-peak slot: "22:00-06:00", "22h00 - 6h00", ["22:00", "06:00"] or
// { start|begin|from, end|to }. The shape the website sends is not
// documented, so every plausible one is read; anything else is null.
function slotOf(entry) {
  if (Array.isArray(entry) && entry.length === 2) {
    const slot = entry.map(timeOf);
    return slot.every(Boolean) ? slot : null;
  }
  if (entry && typeof entry === 'object') {
    const slot = [
      timeOf(entry.start ?? entry.begin ?? entry.from ?? entry.startTime),
      timeOf(entry.end ?? entry.to ?? entry.endTime),
    ];
    return slot.every(Boolean) ? slot : null;
  }
  if (typeof entry === 'string') {
    const parts = entry.split(/\s*(?:-|–|à|to|\/)\s*/).filter(Boolean);
    return parts.length === 2 ? slotOf(parts) : null;
  }
  return null;
}

/**
 * The off-peak slots of the contract, `[["22:00", "06:00"], ...]` (the
 * `time_intervals` format of the Gladys contract wizard), or null.
 */
export function parseOffPeakTimes(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  let entries;
  if (typeof raw === 'string') {
    entries = raw.split(/\s*[,;]\s*|\s+et\s+/);
  } else if (Array.isArray(raw)) {
    // ["22:00", "06:00"] is ONE slot (two bare times), not two slots.
    const bareTimes =
      raw.length === 2 && raw.every((item) => typeof item === 'string' && !/[-–]|à/.test(item));
    entries = bareTimes ? [raw] : raw;
  } else {
    entries = [raw];
  }
  const slots = entries.map(slotOf);
  return slots.length > 0 && slots.every(Boolean) ? slots : null;
}

// -- Price changes ------------------------------------------------------------
//
// A price changes (a new grid, a tax, an indexed offer): the days before are
// charged at the old price. Gladys keeps them apart with successive contracts,
// so the user needs the day the new prices start, and the prices of the days
// since then only.

// On a peak/off-peak day, cost / kWh blends two prices: not a price.
const singleKwh = (day) => (day.peakKwh === null && day.offPeakKwh === null ? day.kwh : null);

const PRICE_WAYS = {
  kwhPrice: unitWays(energyCostOf, singleKwh),
  peakPrice: unitWays(
    (day) => day.peakCost,
    (day) => day.peakKwh,
  ),
  offPeakPrice: unitWays(
    (day) => day.offPeakCost,
    (day) => day.offPeakKwh,
  ),
  subscriptionPerMonth: subscriptionWays,
};

/**
 * The day the latest price change took effect, among the days read, or null.
 * @param {Array<object>} days the parsed days, oldest first
 */
export function priceChangeDay(days) {
  const changes = Object.values(PRICE_WAYS)
    .map((waysOf) => latestRun(days, waysOf))
    .filter((run) => run?.changed)
    .map((run) => run.from);
  return changes.length > 0 ? changes.sort().at(-1) : null;
}

/**
 * The prices of a contract, from its snapshot.
 * The days since the latest price change only (the last 30 at most): the
 * prices are those of today, and `changedOn` is the day they started.
 * @returns {{ energy: string, power: number | null, peakOffPeak: boolean, offPeakSlots: string[][] | null, kwhPrice: number | null, peakPrice: number | null, offPeakPrice: number | null, subscriptionPerMonth: number | null, days: number, changedOn: string | null } | null}
 *   null when no day carries a price
 */
export function contractPrices(snapshot) {
  const { contract } = snapshot;
  const changedOn = priceChangeDay(snapshot.days);
  const days = snapshot.days
    .filter((day) => changedOn === null || day.date >= changedOn)
    .slice(-PRICE_SAMPLE_DAYS);
  const peakOffPeak = contract.priceCategory
    ? contract.priceCategory.toUpperCase() === 'HPHC'
    : days.some((day) => day.peakKwh !== null || day.offPeakKwh !== null);

  const computed = Object.fromEntries(
    Object.entries(PRICE_WAYS).map(([name, waysOf]) => {
      const run = latestRun(days, waysOf);
      const value = run ? middleOf(run.ranges) : null;
      return [name, value === null ? null : round(value, name === 'subscriptionPerMonth' ? 2 : 5)];
    }),
  );
  const prices = {
    energy: contract.energy,
    power: contract.power ?? null,
    peakOffPeak,
    offPeakSlots: parseOffPeakTimes(contract.offPeakTimes),
    kwhPrice: computed.kwhPrice,
    peakPrice: computed.peakPrice,
    offPeakPrice: computed.offPeakPrice,
    subscriptionPerMonth: computed.subscriptionPerMonth,
    days: days.length,
    changedOn,
  };
  const known = [
    prices.kwhPrice,
    prices.peakPrice,
    prices.offPeakPrice,
    prices.subscriptionPerMonth,
  ];
  return known.some((value) => value !== null) ? prices : null;
}

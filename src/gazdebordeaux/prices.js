// -----------------------------------------------------------------------------
// The prices of the customer's OWN contract, read from the customer account.
//
// Gaz de Bordeaux sells fixed-price offers whose price is locked at
// subscription: the current price grid says nothing about a contract signed
// two years ago. The customer account does, indirectly: every day it gives the
// kWh and what they cost (`consumptionPrice`, or `priceHp` / `priceHc` with
// `consumptionHp` / `consumptionHc` on a peak/off-peak contract) and the share
// of the subscription (`contractPrice`). Dividing one by the other gives the
// kWh price actually charged, whatever the offer and its date.
//
// The website rounds each day's amounts to the cent: one day's ratio is off by
// up to a few tenths of a percent (0.1606 instead of 0.160164 on a real
// account). A day costing 1.28 € thus says the exact cost lies between 1.275
// and 1.285 €: each day bounds the price, and the prices are the middle of
// what every day of the last ones allows, rounded to 5 decimals like the
// official grids.
// The user copies them into the Gladys contract wizard: Gladys gives an
// integration no way to fill a contract in.
// -----------------------------------------------------------------------------

/** Days the prices are computed over (the latest ones). */
export const PRICE_SAMPLE_DAYS = 30;

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

/** Half a cent: how far a day's amount, rounded to the cent, is from its exact value. */
const HALF_CENT = 0.005;

// The middle of the values every [low, high] range allows, or null when the
// ranges have nothing in common.
function commonMiddle(ranges) {
  let low = 0;
  let high = Infinity;
  for (const [from, to] of ranges) {
    low = Math.max(low, from);
    high = Math.min(high, to);
  }
  return ranges.length > 0 && low <= high ? (low + high) / 2 : null;
}

// The kWh price of the days that carry both quantities, or null. A day far
// from the median price (a pro-rata, or the days before a price change when
// most days are after it) is left out first. Days that agree on no price
// (amounts not rounded the way assumed) fall back to total cost / total kWh.
function unitPrice(days, costOf, kwhOf) {
  const pairs = days
    .map((day) => [costOf(day), kwhOf(day)])
    .filter(([cost, kwh]) => cost !== null && kwh !== null && cost > 0 && kwh > 0);
  const reference = median(pairs.map(([cost, kwh]) => cost / kwh));
  if (reference === null) {
    return null;
  }
  const kept = pairs.filter(
    ([cost, kwh]) => Math.abs(cost - reference * kwh) <= 2 * HALF_CENT + 0.01 * cost,
  );
  const bounded = commonMiddle(
    kept.map(([cost, kwh]) => [(cost - HALF_CENT) / kwh, (cost + HALF_CENT) / kwh]),
  );
  const kwh = sum(kept.map(([, value]) => value));
  const average = kwh > 0 ? sum(kept.map(([cost]) => cost)) / kwh : reference;
  return round(bounded ?? average, 5);
}

const daysInMonth = (day) =>
  new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();

// The monthly subscription, from the daily shares (`contractPrice`) or null.
//
// The website splits the monthly amount over the days of each month and
// rounds each share to the cent: 15.87 €/month is 0.53 € a day in September
// (30 days) and 0.51 € in October (31 days); "share × 365 / 12" then gives
// 16.12. Each day bounds the monthly amount within
// [(share − ½ cent) × days of its month, (share + ½ cent) × days of its month]:
// the middle of what every day allows is the answer (15.86 here, within a
// cent). Shares that agree on no amount (a yearly amount spread evenly over
// 365 days) fall back to the median share × 365 / 12.
function monthlySubscription(days) {
  const shares = days.filter((day) => day.subscriptionCost !== null && day.subscriptionCost > 0);
  if (shares.length === 0) {
    return null;
  }
  const bounded = commonMiddle(
    shares.map(({ date, subscriptionCost }) => [
      (subscriptionCost - HALF_CENT) * daysInMonth(date),
      (subscriptionCost + HALF_CENT) * daysInMonth(date),
    ]),
  );
  if (bounded !== null) {
    return round(bounded, 2);
  }
  return round((median(shares.map((day) => day.subscriptionCost)) * 365) / 12, 2);
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
// A price changes (a new grid, a tax): the days before are charged at the old
// price. Gladys keeps them apart with successive contracts, so the user needs
// the day the new prices start, and the prices of the days since then only.

/** The latest days the current price is taken from. */
const REFERENCE_DAYS = 3;

// Whether a day's amount matches a price, within its cent rounding plus 1 %.
const close = (amount, expected) => Math.abs(amount - expected) <= 2 * HALF_CENT + 0.01 * amount;

// The first day of the latest run of days charged at the current price, or
// null when no change shows. `priceOf(day)` is the day's own price,
// `agrees(day, price)` whether the day matches a price. One day off (a
// pro-rata, a correction) is not a change: two days in a row that match each
// other but not the current price are.
function latestChange(series, priceOf, agrees) {
  if (series.length < REFERENCE_DAYS + 2) {
    return null;
  }
  const reference = median(series.slice(-REFERENCE_DAYS).map(priceOf));
  let start = series.length - 1;
  for (let i = series.length - 1; i > 0; i -= 1) {
    if (agrees(series[i], reference)) {
      start = i;
    } else if (
      !agrees(series[i - 1], reference) &&
      agrees(series[i - 1], priceOf(series[i])) &&
      start > i
    ) {
      return series[start].date;
    }
  }
  return null;
}

// The days carrying a cost and a quantity of kWh, for one price.
const withKwh = (days, costOf, kwhOf) => days.filter((day) => costOf(day) > 0 && kwhOf(day) > 0);

/**
 * The day the latest price change took effect, among the days read, or null.
 * @param {Array<object>} days the parsed days, oldest first
 */
export function priceChangeDay(days) {
  const unit = (costOf, kwhOf) =>
    latestChange(
      withKwh(days, costOf, kwhOf),
      (day) => costOf(day) / kwhOf(day),
      (day, price) => close(costOf(day), price * kwhOf(day)),
    );
  // On a peak/off-peak day, cost / kWh blends two prices: not a price.
  const single = (day) => (day.peakKwh === null && day.offPeakKwh === null ? day.kwh : null);
  const changes = [
    unit(energyCostOf, single),
    unit(
      (day) => day.peakCost,
      (day) => day.peakKwh,
    ),
    unit(
      (day) => day.offPeakCost,
      (day) => day.offPeakKwh,
    ),
    // The subscription share depends on the days of the month (or is a
    // yearly amount over 365 days): compared as a monthly amount, both ways.
    latestChange(
      days.filter((day) => day.subscriptionCost > 0),
      (day) => day.subscriptionCost * daysInMonth(day.date),
      (day, monthly) =>
        close(day.subscriptionCost, monthly / daysInMonth(day.date)) ||
        close(day.subscriptionCost, (monthly * 12) / 365),
    ),
  ].filter(Boolean);
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
  const splitDays = days.filter((day) => day.peakKwh !== null || day.offPeakKwh !== null);
  const peakOffPeak = contract.priceCategory
    ? contract.priceCategory.toUpperCase() === 'HPHC'
    : splitDays.length > 0;

  const kwhPrice = unitPrice(days, energyCostOf, (day) => day.kwh);
  const peakPrice = unitPrice(
    splitDays,
    (day) => day.peakCost,
    (day) => day.peakKwh,
  );
  const offPeakPrice = unitPrice(
    splitDays,
    (day) => day.offPeakCost,
    (day) => day.offPeakKwh,
  );
  const prices = {
    energy: contract.energy,
    power: contract.power ?? null,
    peakOffPeak,
    offPeakSlots: parseOffPeakTimes(contract.offPeakTimes),
    kwhPrice,
    peakPrice,
    offPeakPrice,
    subscriptionPerMonth: monthlySubscription(days),
    days: days.length,
    changedOn,
  };
  const known = [kwhPrice, peakPrice, offPeakPrice, prices.subscriptionPerMonth];
  return known.some((value) => value !== null) ? prices : null;
}

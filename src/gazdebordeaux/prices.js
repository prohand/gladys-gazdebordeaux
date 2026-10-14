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
// Each price is the median over the last days read (a day with a rounding or
// a pro-rata does not move it), rounded to 5 decimals like the official grids.
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

// The unit prices of the days that carry both quantities, or null.
function unitPrice(days, costOf, kwhOf) {
  const prices = days
    .map((day) => [costOf(day), kwhOf(day)])
    .filter(([cost, kwh]) => cost !== null && kwh !== null && cost > 0 && kwh > 0)
    .map(([cost, kwh]) => cost / kwh);
  const value = median(prices);
  return value === null ? null : round(value, 5);
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

/**
 * The prices of a contract, from its snapshot.
 * @returns {{ energy: string, power: number | null, peakOffPeak: boolean, offPeakSlots: string[][] | null, kwhPrice: number | null, peakPrice: number | null, offPeakPrice: number | null, subscriptionPerMonth: number | null, days: number } | null}
 *   null when no day carries a price
 */
export function contractPrices(snapshot) {
  const { contract } = snapshot;
  const days = snapshot.days.slice(-PRICE_SAMPLE_DAYS);
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
  const dailySubscription = median(
    days.map((day) => day.subscriptionCost).filter((cost) => cost !== null && cost > 0),
  );

  const prices = {
    energy: contract.energy,
    power: contract.power ?? null,
    peakOffPeak,
    offPeakSlots: parseOffPeakTimes(contract.offPeakTimes),
    kwhPrice,
    peakPrice,
    offPeakPrice,
    // A daily share of a yearly subscription: back to the monthly amount
    // of the grids.
    subscriptionPerMonth:
      dailySubscription === null ? null : round((dailySubscription * 365) / 12, 2),
    days: days.length,
  };
  const known = [kwhPrice, peakPrice, offPeakPrice, prices.subscriptionPerMonth];
  return known.some((value) => value !== null) ? prices : null;
}

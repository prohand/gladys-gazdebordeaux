// -----------------------------------------------------------------------------
// The current prices of the customer's own contracts, as
// espaceclient.gazdebordeaux.fr shows them under "Votre prix actuel".
//
// The price of a contract is not the one of the current grid: a fixed-price
// offer keeps the price of its subscription date, an indexed one (Ecodigo
// Elec) moves with taxes and market. The daily amounts of life.gazdebordeaux.fr
// are rounded to the cent: prices computed back from them are approximate
// (0.16066 €/kWh and 16.01 €/month on an account charged 0.160164 and 15.87).
// So the prices are read as the website gives them, never computed.
//
// `/api/contracts/{id}` (field names from the website's own code, not from a
// documented API: every read is null-safe):
//   tarif                         the offer ("OFFRE ECODIGO ELEC ...")
//   optionTarif, power, offPeakHours
//   tarifScale.prixTotalTTCAbo    monthly subscription incl. VAT and taxes
//     (or tarifScale.abo.prixAboTTC)
//   tarifScale.base.prixConsoUniteWithTaxeTTC        base kWh (null on HP/HC)
//   tarifScale.hp / .hc.prixConsoUniteWithTaxeTTC    peak / off-peak kWh
//   tarifScale.prixTotalTTCConso  gas kWh
// -----------------------------------------------------------------------------

import { ENERGIES } from './client.js';
import { toNumber } from './readings.js';

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

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * The current prices of one contract of espaceclient.gazdebordeaux.fr.
 * @param {{ summary: object, details: object }} contract `/api/me` entry and `/api/contracts/{id}`
 * @returns {{ id: string, energy: string, offer: string | null, option: string | null, power: number | null, offPeakSlots: string[][] | null, kwhPrice: number | null, peakPrice: number | null, offPeakPrice: number | null, subscriptionPerMonth: number | null }}
 */
export function currentPrices({ summary, details }) {
  const type = String(summary?.type ?? details?.type ?? '').toLowerCase();
  const energy = type === 'gaz' || type === 'gas' ? ENERGIES.GAS : ENERGIES.ELECTRICITY;
  const scale = details?.tarifScale ?? {};
  const kwhOf = (slot) => toNumber(scale?.[slot]?.prixConsoUniteWithTaxeTTC);
  return {
    id: String(summary?.id ?? details?.id ?? ''),
    energy,
    offer: text(details?.tarif) ?? text(details?.offer),
    option: text(details?.optionTarif),
    power: toNumber(details?.power) || null,
    offPeakSlots: parseOffPeakTimes(details?.offPeakHours),
    kwhPrice: energy === ENERGIES.GAS ? toNumber(scale.prixTotalTTCConso) : kwhOf('base'),
    peakPrice: kwhOf('hp'),
    offPeakPrice: kwhOf('hc'),
    subscriptionPerMonth: toNumber(scale.prixTotalTTCAbo ?? scale.abo?.prixAboTTC),
  };
}

// -----------------------------------------------------------------------------
// The "My contract" energy contract templates (manifest `energy_contracts`,
// `espaceclient-elec-rules` Base and `espaceclient-elec-peak-off-peak-rules`,
// `pricing_mode: "rules"`): the core rule engine prices them with the prices
// the user types, the ones the "My contract prices" button reads on
// espaceclient.gazdebordeaux.fr. Gladys gives an integration no way to fill a
// contract in: this module only gives those prices as a ready-made tariff.
// -----------------------------------------------------------------------------

import { ENERGIES } from '../gazdebordeaux/client.js';

/** The keys of the "My contract" templates in the manifest (never renamed). */
export const MY_CONTRACT_TEMPLATES = [
  'espaceclient-elec-rules',
  'espaceclient-elec-peak-off-peak-rules',
];

const LABELS = {
  peak: 'Heures pleines',
  offPeak: 'Heures creuses',
};

/**
 * The prices read on espaceclient as a Gladys tariff (the `rules` grammar of
 * the contract templates, values as the website gives them): what the user
 * pastes into a contract (the "My contract" templates take the same values).
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

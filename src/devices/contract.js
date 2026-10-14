// -----------------------------------------------------------------------------
// Device type: one Gaz de Bordeaux CONTRACT (a "house" of the customer account).
//
// Read-only sensors, nothing to command. Two kinds of values:
//   - DATED, one per day: the consumption, cost and gas volume of each day
//     read, published with the day as `created_at`, so the charts show the
//     real days and not the time of the read (readings arrive a day or two
//     late);
//   - CURRENT: the month and year totals, re-published when they change.
// An electricity contract also carries a `daily-consumption` feature fed with
// `publishEnergyConsumption`, the Gladys path for "readings that arrive after
// the fact" that energy contracts compute costs from.
//
// The platform id is the uuid of the house: stable for the life of the
// contract, it is what the external ids are built from. Never change it, nor
// the feature keys — Gladys keys the history and the scenes on them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { ENERGIES } from '../gazdebordeaux/client.js';
import { noonOf } from '../gazdebordeaux/dates.js';

export const DEVICE_TYPE = 'contract';

export const FEATURES = {
  DAILY_ENERGY: 'daily-energy',
  DAILY_COST: 'daily-cost',
  DAILY_VOLUME: 'daily-volume',
  MONTH_ENERGY: 'month-energy',
  MONTH_COST: 'month-cost',
  YEAR_ENERGY: 'year-energy',
  YEAR_COST: 'year-cost',
  CONSUMPTION: 'consumption',
};

const ENERGY_NAMES = {
  [ENERGIES.GAS]: 'Gaz',
  [ENERGIES.ELECTRICITY]: 'Électricité',
};

// Every feature declares min/max: they are NOT NULL in Gladys.
const KWH = {
  category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
  type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY,
  unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
  min: 0,
  max: 1_000_000,
};
const EUROS = {
  category: DEVICE_FEATURE_CATEGORIES.CURRENCY,
  type: DEVICE_FEATURE_TYPES.CURRENCY.DECIMAL,
  unit: DEVICE_FEATURE_UNITS.EURO,
  min: 0,
  max: 1_000_000,
};
const CUBIC_METERS = {
  category: DEVICE_FEATURE_CATEGORIES.VOLUME_SENSOR,
  type: DEVICE_FEATURE_TYPES.VOLUME_SENSOR.DECIMAL,
  unit: DEVICE_FEATURE_UNITS.CUBIC_METER,
  min: 0,
  max: 100_000,
};
const DAILY_CONSUMPTION = {
  category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
  type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.DAILY_CONSUMPTION,
  unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
  min: 0,
  max: 1_000_000,
};

/** The features of a contract, by energy. */
export function featureSpecs(energy) {
  const specs = [
    { key: FEATURES.DAILY_ENERGY, name: 'Consommation du jour relevé', ...KWH },
    { key: FEATURES.DAILY_COST, name: 'Coût du jour relevé', ...EUROS },
  ];
  if (energy === ENERGIES.GAS) {
    specs.push({
      key: FEATURES.DAILY_VOLUME,
      name: 'Volume de gaz du jour relevé',
      ...CUBIC_METERS,
    });
  }
  specs.push(
    { key: FEATURES.MONTH_ENERGY, name: 'Consommation du mois', ...KWH },
    { key: FEATURES.MONTH_COST, name: 'Coût du mois', ...EUROS },
    { key: FEATURES.YEAR_ENERGY, name: "Consommation de l'année", ...KWH },
    { key: FEATURES.YEAR_COST, name: "Coût de l'année", ...EUROS },
  );
  if (energy === ENERGIES.ELECTRICITY) {
    specs.push({
      key: FEATURES.CONSUMPTION,
      name: 'Consommation journalière',
      ...DAILY_CONSUMPTION,
    });
  }
  return specs;
}

/** `{ device, feature(key) }` ids of a contract. */
export function contractIds(gladys, contract) {
  return gladys.externalIds(DEVICE_TYPE, contract.id);
}

/**
 * The device name. The supplier is French and so are its customers: the
 * default names are French, the user renames the device at will.
 * @param {object} contract
 * @param {boolean} ambiguous true when another contract has the same energy
 */
export function deviceName(contract, ambiguous) {
  const name = `Gaz de Bordeaux – ${ENERGY_NAMES[contract.energy] ?? contract.energy}`;
  if (!ambiguous) {
    return name;
  }
  return `${name} (${contract.reference ?? contract.id.slice(0, 8)})`;
}

/** The discovery payload of one contract. */
export function buildDevice(gladys, contract, { ambiguous = false } = {}) {
  const ids = contractIds(gladys, contract);
  return {
    name: deviceName(contract, ambiguous),
    external_id: ids.device,
    // Refreshed by the integration's own timer: Gladys polls a minute at the
    // slowest, for readings that change once a day.
    should_poll: false,
    features: featureSpecs(contract.energy).map(({ key, ...spec }) => ({
      external_id: ids.feature(key),
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...spec,
    })),
  };
}

/**
 * Dated states of the days after `afterDay` (all of them when undefined).
 * Each day carries its consumption, its cost and, for gas, its volume.
 */
export function datedStates(gladys, snapshot, afterDay) {
  const ids = contractIds(gladys, snapshot.contract);
  const withVolume = snapshot.contract.energy === ENERGIES.GAS;
  const states = [];
  for (const day of snapshot.days) {
    if (afterDay !== undefined && day.date <= afterDay) {
      continue;
    }
    const created_at = noonOf(day.date);
    states.push({
      device_feature_external_id: ids.feature(FEATURES.DAILY_ENERGY),
      state: day.kwh,
      created_at,
    });
    if (day.cost !== null) {
      states.push({
        device_feature_external_id: ids.feature(FEATURES.DAILY_COST),
        state: day.cost,
        created_at,
      });
    }
    if (withVolume && day.volume !== null) {
      states.push({
        device_feature_external_id: ids.feature(FEATURES.DAILY_VOLUME),
        state: day.volume,
        created_at,
      });
    }
  }
  return states;
}

/** The month and year totals, as current states. */
export function totalStates(gladys, snapshot) {
  const ids = contractIds(gladys, snapshot.contract);
  return [
    [FEATURES.MONTH_ENERGY, snapshot.month.kwh],
    [FEATURES.MONTH_COST, snapshot.month.cost],
    [FEATURES.YEAR_ENERGY, snapshot.year.kwh],
    [FEATURES.YEAR_COST, snapshot.year.cost],
  ]
    .filter(([, state]) => state !== null)
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
}

/**
 * The `publishEnergyConsumption` intervals of an electricity contract: every
 * day read before `today` (a day still running is not elapsed yet).
 */
export function consumptionIntervals(snapshot, today) {
  if (snapshot.contract.energy !== ENERGIES.ELECTRICITY) {
    return [];
  }
  return snapshot.days.filter((day) => day.date < today).map(({ date, kwh }) => ({ date, kwh }));
}

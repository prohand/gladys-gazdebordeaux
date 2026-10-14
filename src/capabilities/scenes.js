// -----------------------------------------------------------------------------
// Scene triggers and actions (SDK v0.14+, Gladys 5.1+).
//
// Triggers (manifest `scene_triggers`), fired by index.js after a refresh:
//   - daily_reading      a new day was read for a contract;
//   - high_consumption   that day goes above the alert threshold of the config;
//   - connection_failed  a read failed after the previous one succeeded.
// One event per transition: a day is announced once (the last announced day
// is kept in the store, so a restart does not announce it again) and a
// failure only when the account was working before.
//
// Actions (manifest `scene_actions`), handled here:
//   - refresh_now        read the account now;
//   - get_consumption    hand a consumption to the following actions.
// Never fire an event because of a received action... except that
// refresh_now runs a normal refresh, which announces a NEW day if there is
// one: it is the day that triggers, not the action, and a day is announced
// once whatever reads it — no loop possible.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { alertThreshold } from '../config.js';
import { contractIds } from '../devices/contract.js';
import { findContract } from '../devices/index.js';
import { errorReason } from '../messages.js';

const logger = createLogger({ name: 'scenes' });

export const TRIGGERS = {
  DAILY_READING: 'daily_reading',
  HIGH_CONSUMPTION: 'high_consumption',
  CONNECTION_FAILED: 'connection_failed',
};

/** Every trigger key the code fires (checked against the manifest). */
export const SCENE_TRIGGER_KEYS = Object.values(TRIGGERS);

/**
 * Fire the reading events of every snapshot whose latest day was not
 * announced yet. The very first read of a contract only records its latest
 * day: announcing a day already weeks old would surprise more than help.
 */
export async function fireReadingEvents(gladys, account, { store, config }) {
  for (const snapshot of account.state.snapshots.values()) {
    const { contract, lastDay } = snapshot;
    if (!lastDay) {
      continue;
    }
    const { lastEventDay } = store.get(contract.id);
    if (lastEventDay !== undefined && lastDay.date <= lastEventDay) {
      continue;
    }
    store.update(contract.id, { lastEventDay: lastDay.date });
    await store.save();
    if (lastEventDay === undefined) {
      continue;
    }

    const device = contractIds(gladys, contract).device;
    logger.info(`New reading for contract ${contract.id}: ${lastDay.date}, ${lastDay.kwh} kWh`);
    await gladys.publishSceneEvent(TRIGGERS.DAILY_READING, {
      device,
      energy: contract.energy,
      date: lastDay.date,
      kwh: lastDay.kwh,
      cost: lastDay.cost,
      volume: lastDay.volume,
    });

    const threshold = alertThreshold(config, contract.energy);
    if (threshold > 0 && lastDay.kwh > threshold) {
      logger.info(
        `High consumption for contract ${contract.id}: ${lastDay.kwh} > ${threshold} kWh`,
      );
      await gladys.publishSceneEvent(TRIGGERS.HIGH_CONSUMPTION, {
        device,
        energy: contract.energy,
        date: lastDay.date,
        kwh: lastDay.kwh,
        threshold,
      });
    }
  }
}

/** Fire `connection_failed` (call it only on the working -> failing edge). */
export function fireConnectionFailed(gladys, err) {
  return gladys.publishSceneEvent(TRIGGERS.CONNECTION_FAILED, {
    reason: errorReason(err),
    message: String(err?.message ?? err).slice(0, 1000),
  });
}

/** The values `get_consumption` hands over, by period. */
function valuesOf(snapshot, period) {
  if (period === 'month') {
    return snapshot.month;
  }
  if (period === 'year') {
    return snapshot.year;
  }
  return snapshot.lastDay ?? { kwh: null, cost: null, volume: null };
}

// Each handler receives the integration context (gladys, account, refresh)
// and the RESOLVED fields; it resolves the declared outputs only.
export const SCENE_ACTIONS = {
  async refresh_now(context) {
    logger.info('Scene action refresh_now');
    const { ok } = await context.refresh('scene');
    return { success: ok, contracts: context.account.state.contracts.length };
  },

  async get_consumption({ gladys, account }, fields) {
    const contract = findContract(gladys, account.state.contracts, fields.device);
    const snapshot = contract && account.state.snapshots.get(contract.id);
    // Not a failure: a scene action is never a condition, the scene author
    // gates the following actions on `available`.
    if (!snapshot) {
      return { available: false, kwh: null, cost: null, volume: null, date: null };
    }
    const { kwh, cost, volume } = valuesOf(snapshot, fields.period ?? 'last_day');
    return {
      available: kwh !== null,
      kwh,
      cost,
      volume,
      date: snapshot.lastDay?.date ?? null,
    };
  },
};

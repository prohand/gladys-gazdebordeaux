// -----------------------------------------------------------------------------
// Publication of the snapshots read from the customer account.
//
// Only the devices the user created receive states: Gladys has nowhere to
// store the others. A device created later is caught up from the snapshot
// (index.js calls this again on onDeviceCreated), history included.
//
// The host API accepts 300 states a minute. The first import of a contract
// (30 days × 3 features, more with several contracts or a longer history) can
// go past it, so the dated states are sent in batches spaced a minute apart.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { ENERGIES } from './gazdebordeaux/client.js';
import { daysBetween } from './gazdebordeaux/dates.js';
import {
  consumptionIntervals,
  contractIds,
  datedStates,
  FEATURES,
  totalStates,
} from './devices/contract.js';
import { isCreated } from './devices/index.js';
import { localize, pick } from './i18n.js';

const logger = createLogger({ name: 'publish' });

/** States per request (host API maximum: 100) and per minute (limit: 300). */
export const BATCH_SIZE = 100;
export const STATES_PER_MINUTE = 250;
const MINUTE_MS = 60_000;

/** The month and year totals are re-sent once a day even when unchanged. */
const TOTALS_HEARTBEAT_MS = 24 * 60 * 60 * 1000;

/** A latest reading older than this flags the transport badge as degraded. */
export const STALE_AFTER_DAYS = 4;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send `states` in batches of BATCH_SIZE, pausing a minute every
 * STATES_PER_MINUTE states.
 */
export async function publishPaced(gladys, states, { sleep = wait } = {}) {
  let sentThisMinute = 0;
  for (let index = 0; index < states.length; index += BATCH_SIZE) {
    const batch = states.slice(index, index + BATCH_SIZE);
    if (sentThisMinute + batch.length > STATES_PER_MINUTE) {
      logger.info(`Pausing a minute: ${states.length - index} states left to import`);
      await sleep(MINUTE_MS);
      sentThisMinute = 0;
    }
    await gladys.publishStates(batch);
    sentThisMinute += batch.length;
  }
}

/**
 * Publish one snapshot on its device: the days not published yet, the
 * current totals and, for electricity, the dated consumption.
 * Resolves false when the device is not created yet (nothing sent).
 */
export async function publishSnapshot(gladys, snapshot, { store, today, sleep }) {
  const { contract } = snapshot;
  const ids = contractIds(gladys, contract);
  if (!isCreated(gladys, ids.device)) {
    logger.debug(`Contract ${contract.id} not created in Gladys yet, nothing published`);
    return false;
  }

  const { lastPublishedDay } = store.get(contract.id);
  const dated = datedStates(gladys, snapshot, lastPublishedDay);
  if (dated.length > 0) {
    logger.info(`Contract ${contract.id}: publishing ${dated.length} dated states`);
    await publishPaced(gladys, dated, { sleep });
  }
  if (snapshot.lastDay) {
    store.update(contract.id, { lastPublishedDay: snapshot.lastDay.date });
    await store.save();
  }

  await gladys.publishChangedStates(totalStates(gladys, snapshot), {
    heartbeat: TOTALS_HEARTBEAT_MS,
  });

  const intervals = consumptionIntervals(snapshot, today);
  if (intervals.length > 0) {
    // Upserted by day by the core: sending the whole window again is free.
    // A Gladys too old for this path refuses it: the other features still
    // work, so it is a warning, not a failed refresh.
    try {
      await gladys.publishEnergyConsumption(ids.feature(FEATURES.CONSUMPTION), intervals);
    } catch (err) {
      logger.warn(`Daily consumption of contract ${contract.id} not accepted: ${err.message}`);
    }
  }
  return true;
}

/** Publish every snapshot of the account. */
export async function publishAll(gladys, account, options) {
  for (const snapshot of account.state.snapshots.values()) {
    await publishSnapshot(gladys, snapshot, options);
  }
}

/**
 * The transport badge of each created contract device: `cloud` after a
 * successful read, `unreachable` after a failed one, and `degraded` when the
 * account answers but its latest reading is days old (a meter that stopped
 * reporting, a reading delayed by the supplier).
 */
export function buildTransportEntries(gladys, account, today) {
  const healthy = account.isHealthy();
  return account.state.contracts
    .map((contract) => ({ contract, external_id: contractIds(gladys, contract).device }))
    .filter(({ external_id }) => isCreated(gladys, external_id))
    .map(({ contract, external_id }) => {
      if (!healthy) {
        return { external_id, transport: DEVICE_TRANSPORTS.UNREACHABLE };
      }
      const lastDay = account.state.snapshots.get(contract.id)?.lastDay;
      const age = lastDay ? daysBetween(lastDay.date, today) : null;
      if (age === null || age > STALE_AFTER_DAYS) {
        return {
          external_id,
          transport: DEVICE_TRANSPORTS.CLOUD,
          degraded: true,
          message: staleMessage(contract, age),
        };
      }
      return { external_id, transport: DEVICE_TRANSPORTS.CLOUD };
    });
}

function staleMessage(contract, age) {
  const gas = contract.energy === ENERGIES.GAS;
  return localize((language) => {
    if (age === null) {
      return pick(language, {
        en: 'No reading available on the customer account yet.',
        fr: "Aucun relevé disponible sur l'espace client pour l'instant.",
        de: 'Noch kein Wert im Kundenkonto verfügbar.',
        es: 'Todavía no hay lecturas en la cuenta de cliente.',
      });
    }
    const meter = gas
      ? pick(language, {
          en: 'gas meter',
          fr: 'compteur de gaz',
          de: 'Gaszähler',
          es: 'contador de gas',
        })
      : pick(language, {
          en: 'electricity meter',
          fr: "compteur d'électricité",
          de: 'Stromzähler',
          es: 'contador eléctrico',
        });
    return pick(language, {
      en: `The latest reading is ${age} days old: check the ${meter}.`,
      fr: `Le dernier relevé date de ${age} jours : vérifiez le ${meter}.`,
      de: `Der letzte Wert ist ${age} Tage alt: prüfen Sie den ${meter}.`,
      es: `La última lectura tiene ${age} días: compruebe el ${meter}.`,
    });
  });
}

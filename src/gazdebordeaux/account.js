// -----------------------------------------------------------------------------
// The customer account: what was read from it last, and how to read it again.
//
// One refresh signs in (the client re-uses its token while it is valid), lists
// the contracts, then reads for each one:
//   - the daily readings since the oldest of "history_days ago" and "the 1st
//     of this month" — they feed the dated history AND the month total;
//   - the year total.
// The result is kept as one snapshot per contract, so the widget, the scene
// actions and a device created later are served without calling the website.
// -----------------------------------------------------------------------------

import { createClient, ENERGIES, ERROR_KINDS, GdbError } from './client.js';
import { currentPrices } from './prices.js';
import { addDays, firstOfMonth, parisDay } from './dates.js';
import { parseDaily, parseTotal, sumDays } from './readings.js';

/** The energies a device is offered for. */
const SUPPORTED_ENERGIES = Object.values(ENERGIES);

/**
 * @param {{ clientFactory?: typeof createClient, today?: () => string, now?: () => Date }} [options]
 */
export function createAccount({
  clientFactory = createClient,
  today = () => parisDay(),
  now = () => new Date(),
} = {}) {
  const state = {
    /** @type {Array<{ id: string, path: string, energy: string, reference: string | null }>} */
    contracts: [],
    /** contract id -> snapshot */
    snapshots: new Map(),
    /** @type {Date | null} */
    lastSuccessAt: null,
    /** @type {Date | null} */
    lastAttemptAt: null,
    /** @type {GdbError | Error | null} */
    lastError: null,
    /** The current prices of every contract, as last read on espaceclient. */
    prices: [],
  };

  let client = null;
  let credentials = null;

  // A new client (and so a new sign-in) only when the credentials changed.
  function clientFor(config) {
    const key = JSON.stringify([config.email, config.password]);
    if (!client || key !== credentials) {
      client = clientFactory({ email: config.email, password: config.password });
      credentials = key;
    }
    return client;
  }

  function assertConfigured(config) {
    if (!config.email || !config.password) {
      throw new GdbError(ERROR_KINDS.NOT_CONFIGURED, 'Email and password are not filled in yet');
    }
  }

  async function readContract(api, contract, config) {
    const end = today();
    const monthStart = firstOfMonth(end);
    const historyStart = addDays(end, -config.history_days);
    const start = historyStart < monthStart ? historyStart : monthStart;

    const days = parseDaily(
      await api.getConsumptions(contract.path, { scale: 'month', startDate: start, endDate: end }),
    );
    const year = parseTotal(await api.getConsumptions(contract.path, { scale: 'year' }));
    return {
      contract,
      days,
      lastDay: days.at(-1) ?? null,
      month: sumDays(days, monthStart),
      year,
      readAt: now(),
    };
  }

  /**
   * Read the whole account. On success the snapshots are replaced; on failure
   * the previous ones are kept (still worth showing) and the error is thrown.
   */
  async function refresh(config) {
    state.lastAttemptAt = now();
    try {
      assertConfigured(config);
      const api = clientFor(config);
      const contracts = (await api.getContracts()).filter((contract) =>
        SUPPORTED_ENERGIES.includes(contract.energy),
      );
      if (contracts.length === 0) {
        throw new GdbError(
          ERROR_KINDS.NO_CONTRACT,
          'No gas or electricity contract on this Gaz de Bordeaux account',
        );
      }
      const snapshots = new Map();
      for (const contract of contracts) {
        snapshots.set(contract.id, await readContract(api, contract, config));
      }
      state.contracts = contracts;
      state.snapshots = snapshots;
      state.lastSuccessAt = now();
      state.lastError = null;
      return state;
    } catch (err) {
      state.lastError = err;
      throw err;
    }
  }

  /**
   * Sign in and list the contracts with the given credentials, without
   * touching the current state (the "Test the connection" button).
   */
  async function testConnection(config) {
    assertConfigured(config);
    return clientFactory({ email: config.email, password: config.password }).getContracts();
  }

  /**
   * The current prices of every contract, read on espaceclient.gazdebordeaux.fr
   * (on demand: they change rarely).
   */
  async function readPrices(config) {
    assertConfigured(config);
    state.prices = (await clientFor(config).getContractDetails()).map(currentPrices);
    return state.prices;
  }

  /** True when the last refresh succeeded. */
  function isHealthy() {
    return state.lastSuccessAt !== null && state.lastError === null;
  }

  return { state, refresh, testConnection, readPrices, isHealthy };
}

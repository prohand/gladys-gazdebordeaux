// -----------------------------------------------------------------------------
// The integration: SDK handlers wired to the customer account.
//
// Kept apart from index.js so the tests drive it with the SDK's fake Gladys
// (`createFakeGladys`) exactly as the real one would.
//
// Life of a refresh (timer, button, scene, widget, configuration saved):
//   read the account -> publish the devices (Discovery tab) -> report the
//   connection -> publish the states of the created devices -> fire the scene
//   events -> publish the transport badges -> nudge the widget.
// Refreshes never overlap: a request arriving during one waits for it.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig } from './config.js';
import { createAccount } from './gazdebordeaux/account.js';
import { parisDay } from './gazdebordeaux/dates.js';
import { buildDiscoveredDevices } from './devices/index.js';
import { buildTransportEntries, publishAll } from './publish.js';
import { contractsFoundMessage, errorMessage, refreshedMessage } from './messages.js';
import { fireConnectionFailed, fireReadingEvents, SCENE_ACTIONS } from './capabilities/scenes.js';
import { refreshWidgets, WIDGETS } from './capabilities/widget.js';
import { createFileStore } from './store.js';

const logger = createLogger({ name: 'integration' });

const HOUR_MS = 60 * 60 * 1000;

/**
 * Register every handler on `gladys`.
 * @param {object} gladys a GladysIntegration (or the SDK fake)
 * @param {{ account?: object, store?: object, today?: () => string, sleep?: (ms: number) => Promise<void> }} [options]
 */
export function createIntegration(
  gladys,
  { account = createAccount(), store = createFileStore(), today = () => parisDay(), sleep } = {},
) {
  let config = normalizeConfig();
  let timer = null;
  let running = null;
  let storeLoaded = false;

  async function loadStore() {
    if (!storeLoaded) {
      await store.load();
      storeLoaded = true;
    }
  }

  async function publishTransports() {
    const entries = buildTransportEntries(gladys, account, today());
    if (entries.length > 0) {
      await gladys.publishTransports(entries);
    }
  }

  async function runRefresh(origin) {
    await loadStore();
    if (!isConfigured(config)) {
      logger.info('Customer account not configured yet');
      await gladys.setConnectionStatus(false, errorMessage({ kind: 'not_configured' }));
      return { ok: false, error: { kind: 'not_configured' } };
    }

    const wasHealthy = account.isHealthy();
    logger.info(`Refreshing the customer account (${origin})`);
    try {
      await account.refresh(config);
    } catch (error) {
      logger.error(`Refresh failed (${error.kind ?? 'error'}): ${error.message}`);
      await gladys.setConnectionStatus(false, errorMessage(error)).catch(() => {});
      await publishTransports().catch((err) => logger.warn('Transport badges', err));
      if (wasHealthy) {
        await fireConnectionFailed(gladys, error).catch((err) => logger.warn('Scene event', err));
      }
      refreshWidgets(gladys);
      return { ok: false, error };
    }

    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, account.state.contracts));
    await gladys.setConnectionStatus(true);
    await publishAll(gladys, account, { store, today: today(), sleep });
    await fireReadingEvents(gladys, account, { store, config });
    await publishTransports();
    refreshWidgets(gladys);
    return { ok: true };
  }

  /**
   * Read the account and publish everything. Never rejects: resolves
   * `{ ok, error? }`, the error being logged and shown as the connection
   * status already.
   */
  function refresh(origin = 'manual') {
    if (!running) {
      running = runRefresh(origin)
        .catch((error) => {
          // A Gladys-side failure (publication refused, socket lost...).
          logger.error('Refresh interrupted', error);
          return { ok: false, error };
        })
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  function stopTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    stopTimer();
    timer = setTimeout(async () => {
      await refresh('timer');
      schedule();
    }, config.refresh_hours * HOUR_MS);
    timer.unref?.();
  }

  const context = {
    gladys,
    account,
    refresh,
    get config() {
      return config;
    },
  };

  // --- Discovery: Gladys asks for the list of devices ------------------------
  gladys.onScanRequest(async () => {
    if (account.state.contracts.length === 0) {
      await refresh('scan');
    }
    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, account.state.contracts));
  });

  // --- A device was created from the Discovery tab: catch it up ------------
  gladys.onDeviceCreated(async (device) => {
    logger.info(`Device created: ${device.external_id}`);
    await loadStore();
    await publishAll(gladys, account, { store, today: today(), sleep });
    await publishTransports();
  });

  // --- Manifest actions: buttons in the Configuration screen ---------------
  gladys.onAction('test_connection', async () => {
    try {
      const contracts = await account.testConnection(config);
      return contractsFoundMessage(contracts);
    } catch (error) {
      logger.warn(`Connection test failed: ${error.message}`);
      return errorMessage(error);
    }
  });

  gladys.onAction('refresh_now', async () => {
    const { ok, error } = await refresh('button');
    return ok ? refreshedMessage(account) : errorMessage(error);
  });

  // --- Scene actions (Gladys 5.1+) -----------------------------------------
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(context, fields));
  }

  // --- Dashboard widgets (Gladys 5.1+) -------------------------------------
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(context, request));
    gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
      widget.action(context, { actionKey, params, settings }),
    );
  }

  // --- Configuration saved by the user --------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    config = normalizeConfig(newConfig);
    await refresh('configuration');
    schedule();
  });

  // --- Connection lifecycle -------------------------------------------------
  gladys.on('connected', async () => {
    config = normalizeConfig(await gladys.getConfig());
    await refresh('startup');
    schedule();
  });

  gladys.on('disconnected', () => {
    stopTimer();
  });

  return { refresh, stop: stopTimer, context };
}

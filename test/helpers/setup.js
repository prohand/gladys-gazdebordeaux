// -----------------------------------------------------------------------------
// One integration wired to the SDK's fake Gladys and to the fake website.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createAccount } from '../../src/gazdebordeaux/account.js';
import { createClient } from '../../src/gazdebordeaux/client.js';
import { createIntegration } from '../../src/integration.js';
import { createMemoryStore } from '../../src/store.js';
import { createFakeWebsite, EMAIL, PASSWORD, TODAY } from './fakeWebsite.js';

export const CREDENTIALS = { email: EMAIL, password: PASSWORD };

/**
 * @param {import('node:test').TestContext} t
 * @param {{ config?: object, site?: object, store?: object, devices?: object[], today?: string, connect?: boolean, fake?: object }} [options]  `fake`: more options of the fake Gladys
 */
export async function setup(
  t,
  {
    config = CREDENTIALS,
    site = createFakeWebsite(),
    store = createMemoryStore(),
    devices = [],
    today = TODAY,
    connect = true,
    fake = {},
  } = {},
) {
  const gladys = createFakeGladys({ config, devices, ...fake });
  const account = createAccount({
    clientFactory: (options) => createClient({ ...options, fetchImpl: site.fetch }),
    today: () => today,
  });
  const sleeps = [];
  const integration = createIntegration(gladys, {
    account,
    store,
    today: () => today,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  t.after(() => integration.stop());
  if (connect) {
    await gladys.connect();
  }
  return { gladys, site, store, account, integration, sleeps };
}

/** Create every discovered device, like the user in the Discovery tab. */
export async function createAllDevices(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}

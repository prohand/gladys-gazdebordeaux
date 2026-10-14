import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  buildDevice,
  consumptionIntervals,
  datedStates,
  FEATURES,
  totalStates,
} from '../src/devices/contract.js';
import { buildDiscoveredDevices, findContract } from '../src/devices/index.js';
import { buildTransportEntries, publishPaced, STATES_PER_MINUTE } from '../src/publish.js';

const gladys = createFakeGladys();
const GAS = { id: 'gas-uuid', path: '/api/houses/gas-uuid', energy: 'gas', reference: null };
const ELEC = {
  id: 'elec-uuid',
  path: '/api/houses/elec-uuid',
  energy: 'electricity',
  reference: 'PDL123',
};

const snapshotOf = (contract, days) => ({
  contract,
  days,
  lastDay: days.at(-1) ?? null,
  month: { kwh: 10, volume: 1, cost: 2 },
  year: { kwh: 100, volume: null, cost: 20 },
  readAt: new Date('2026-10-14T08:00:00Z'),
});
const DAYS = [
  { date: '2026-10-12', kwh: 40, volume: 3.6, cost: 4.8, temperature: 12 },
  { date: '2026-10-13', kwh: 41, volume: null, cost: null, temperature: 11 },
];

test('Gladys accepts the discovery payload of a gas and an electricity contract', async () => {
  const fresh = createFakeGladys();
  await fresh.publishDiscoveredDevices(buildDiscoveredDevices(fresh, [GAS, ELEC]));
  assert.equal(fresh.fake.discoveredDevices.length, 2);
});

test('the features follow the energy of the contract', () => {
  const keysOf = (contract) =>
    buildDevice(gladys, contract).features.map((f) => f.external_id.split(':').at(-1));
  assert.ok(keysOf(GAS).includes(FEATURES.DAILY_VOLUME));
  assert.ok(!keysOf(GAS).includes(FEATURES.CONSUMPTION));
  assert.ok(keysOf(ELEC).includes(FEATURES.CONSUMPTION));
  assert.ok(!keysOf(ELEC).includes(FEATURES.DAILY_VOLUME));
});

test('every feature is a read-only sensor with min and max, and nothing is polled', () => {
  for (const contract of [GAS, ELEC]) {
    const device = buildDevice(gladys, contract);
    assert.notEqual(device.should_poll, true);
    for (const feature of device.features) {
      assert.equal(feature.read_only, true);
      assert.equal(typeof feature.min, 'number');
      assert.equal(typeof feature.max, 'number');
    }
  }
});

test('two contracts of the same energy get distinct names', () => {
  const other = { ...GAS, id: 'second-gas-uuid', reference: 'PCE42' };
  const names = buildDiscoveredDevices(gladys, [GAS, other, ELEC]).map((d) => d.name);
  assert.deepEqual(names, [
    'Gaz de Bordeaux – Gaz (gas-uuid)',
    'Gaz de Bordeaux – Gaz (PCE42)',
    'Gaz de Bordeaux – Électricité',
  ]);
});

test('findContract routes a device external_id back to its contract', () => {
  const device = buildDevice(gladys, ELEC);
  assert.equal(findContract(gladys, [GAS, ELEC], device.external_id), ELEC);
  assert.equal(findContract(gladys, [GAS, ELEC], 'unknown'), undefined);
});

test('dated states skip the days already published and the values a day lacks', () => {
  const all = datedStates(gladys, snapshotOf(GAS, DAYS));
  assert.equal(all.length, 4, '3 values on the 12th, the kWh only on the 13th');
  const later = datedStates(gladys, snapshotOf(GAS, DAYS), '2026-10-12');
  assert.deepEqual(
    later.map((s) => [s.device_feature_external_id.split(':').at(-1), s.created_at]),
    [[FEATURES.DAILY_ENERGY, '2026-10-13T12:00:00.000Z']],
  );
});

test('the totals leave out what the account does not give', () => {
  const keys = totalStates(gladys, snapshotOf(GAS, DAYS)).map((s) =>
    s.device_feature_external_id.split(':').at(-1),
  );
  assert.deepEqual(keys, [
    FEATURES.MONTH_ENERGY,
    FEATURES.MONTH_COST,
    FEATURES.YEAR_ENERGY,
    FEATURES.YEAR_COST,
  ]);
});

test('only electricity feeds the energy path, and only elapsed days', () => {
  assert.deepEqual(consumptionIntervals(snapshotOf(GAS, DAYS), '2026-10-14'), []);
  assert.deepEqual(consumptionIntervals(snapshotOf(ELEC, DAYS), '2026-10-13'), [
    { date: '2026-10-12', kwh: 40 },
  ]);
});

test('publishPaced pauses a minute every 250 states', async () => {
  const fresh = createFakeGladys();
  const states = Array.from({ length: 600 }, (_, i) => ({
    device_feature_external_id: fresh.externalIds('contract', 'x').feature('daily-energy'),
    state: i,
    created_at: '2026-10-13T12:00:00.000Z',
  }));
  const sleeps = [];
  await publishPaced(fresh, states, { sleep: async (ms) => sleeps.push(ms) });
  assert.equal(fresh.fake.states.length, 600);
  assert.equal(sleeps.length, Math.ceil(600 / STATES_PER_MINUTE) - 1);
});

function accountWith(snapshot, { healthy = true } = {}) {
  return {
    state: {
      contracts: [snapshot.contract],
      snapshots: new Map([[snapshot.contract.id, snapshot]]),
    },
    isHealthy: () => healthy,
  };
}

test('the transport badge is cloud, unreachable, or degraded when the readings are stale', async () => {
  const fresh = createFakeGladys({ devices: [buildDevice(createFakeGladys(), GAS)] });
  await fresh.getDevices();
  const snapshot = snapshotOf(GAS, DAYS);

  const [nominal] = buildTransportEntries(fresh, accountWith(snapshot), '2026-10-14');
  assert.deepEqual(nominal, {
    external_id: buildDevice(fresh, GAS).external_id,
    transport: DEVICE_TRANSPORTS.CLOUD,
  });

  const [failing] = buildTransportEntries(
    fresh,
    accountWith(snapshot, { healthy: false }),
    '2026-10-14',
  );
  assert.equal(failing.transport, DEVICE_TRANSPORTS.UNREACHABLE);

  const [stale] = buildTransportEntries(fresh, accountWith(snapshot), '2026-10-25');
  assert.equal(stale.transport, DEVICE_TRANSPORTS.CLOUD);
  assert.equal(stale.degraded, true);
  assert.match(stale.message.fr, /12 jours/);
  for (const text of Object.values(stale.message)) {
    assert.ok(text.length <= 200);
  }
});

test('a device the user did not create gets no badge', () => {
  const [entry] = buildTransportEntries(gladys, accountWith(snapshotOf(GAS, DAYS)), '2026-10-14');
  assert.equal(entry, undefined);
});

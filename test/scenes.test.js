import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contractIds } from '../src/devices/contract.js';
import { TRIGGERS } from '../src/capabilities/scenes.js';
import { CREDENTIALS, setup } from './helpers/setup.js';
import { createFakeWebsite, ELEC_ID, GAS_ID } from './helpers/fakeWebsite.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declarationOf = (list, key) => manifest[list].find((entry) => entry.key === key);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function addDay(site, id, date, kwh) {
  site.days[id].push({ date, kwh, volumeOfEnergy: 1, price: 1, ratio: 0, temperature: 5 });
}

test('scene event data only carries the keys its trigger declares, as primitives', async (t) => {
  const site = createFakeWebsite();
  const { gladys, integration } = await setup(t, {
    site,
    config: { ...CREDENTIALS, gas_alert_kwh: 10, electricity_alert_kwh: 10 },
  });
  addDay(site, GAS_ID, '2026-10-14', 50);
  addDay(site, ELEC_ID, '2026-10-14', 50);
  await integration.refresh('test');
  site.blocked = true;
  await integration.refresh('test');

  const fired = new Set(gladys.fake.sceneEvents.map(({ key }) => key));
  assert.deepEqual([...fired].sort(), Object.values(TRIGGERS).sort(), 'every trigger demonstrated');
  for (const { key, data } of gladys.fake.sceneEvents) {
    const trigger = declarationOf('scene_triggers', key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    for (const [name, value] of Object.entries(data)) {
      assert.ok(declared.includes(name), `${key}: data.${name} would be dropped by the core`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${name} is a primitive`);
    }
    // Every static filter value the code sends is one of the declared options.
    for (const field of trigger.fields.filter((f) => f.options)) {
      assert.ok(
        field.options.some((option) => option.value === data[field.key]),
        `${key}: data.${field.key} "${data[field.key]}" is not an option`,
      );
    }
  }
});

test('the threshold is per energy and 0 turns the alert off', async (t) => {
  const site = createFakeWebsite();
  const { gladys, integration } = await setup(t, {
    site,
    config: { ...CREDENTIALS, gas_alert_kwh: 0, electricity_alert_kwh: 30 },
  });
  addDay(site, GAS_ID, '2026-10-14', 500);
  addDay(site, ELEC_ID, '2026-10-14', 31);
  await integration.refresh('test');
  const high = gladys.fake.sceneEvents.filter(({ key }) => key === TRIGGERS.HIGH_CONSUMPTION);
  assert.deepEqual(
    high.map(({ data }) => [data.energy, data.kwh, data.threshold]),
    [['electricity', 31, 30]],
  );
});

test('get_consumption hands over the declared outputs, by period', async (t) => {
  const { gladys } = await setup(t);
  const device = contractIds(gladys, { id: GAS_ID }).device;
  const declared = keysOf(declarationOf('scene_actions', 'get_consumption').outputs);

  for (const period of ['last_day', 'month', 'year']) {
    const ack = await gladys.fake.sceneAction('get_consumption', { device, period });
    assert.equal(ack.success, true);
    const outputs = ack.data.outputs;
    assert.deepEqual(Object.keys(outputs).sort(), [...declared].sort(), period);
    assert.equal(outputs.available, true);
    assert.equal(outputs.date, '2026-10-13');
  }
  const year = await gladys.fake.sceneAction('get_consumption', { device, period: 'year' });
  assert.equal(year.data.outputs.kwh, 4321.5);
});

test('get_consumption on an unknown device says it through `available`, not a failure', async (t) => {
  const { gladys } = await setup(t);
  const ack = await gladys.fake.sceneAction('get_consumption', { device: 'unknown' });
  assert.equal(ack.success, true);
  assert.equal(ack.data.outputs.available, false);
});

test('refresh_now reads the account and reports its outcome', async (t) => {
  const site = createFakeWebsite();
  const { gladys } = await setup(t, { site });
  const ok = await gladys.fake.sceneAction('refresh_now', {});
  assert.deepEqual(ok.data.outputs, { success: true, contracts: 2 });

  site.down = true;
  const failed = await gladys.fake.sceneAction('refresh_now', {});
  assert.equal(failed.success, true, 'a failed read is an output, not a failed action');
  assert.equal(failed.data.outputs.success, false);
});
